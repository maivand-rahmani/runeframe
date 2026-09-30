import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSgrInputMultiplexer } from '../../../interaction/mouse/SgrInputMultiplexer.js'
import type { MouseEventSource } from '../../../interaction/mouse/MouseEventSource.js'
import {
  startWindowsHelperProcess,
  type WindowsHelperProcess,
} from './transport.js'

/**
 * Standalone Windows input transport for Ink 7 applications.
 *
 * The native helper owns the console input queue (`CONIN$`) and writes JSON
 * records; this factory translates them into one byte source and routes that
 * source through the shared SGR input multiplexer, so:
 *  - `stdin` (the multiplexer's Ink-facing stream) carries keyboard bytes only,
 *  - `mouseEvents` publishes normalized press/release/wheel reports,
 *  - the helper remains the sole console queue owner and JavaScript never
 *    reads `process.stdin` or calls `process.stdin.setRawMode`.
 *
 * Usage (invoked before `render`), with the host-owned failure latch:
 *
 * ```ts
 * import { render } from 'ink'
 *
 * let instance: ReturnType<typeof render> | undefined
 * let pendingFailure: Error | undefined
 *
 * const input = await createWindowsInputTransport({
 *   onInputFailure: (error) => {
 *     pendingFailure = error
 *     instance?.unmount()
 *   },
 * })
 *
 * try {
 *   instance = render(<App />, { stdin: input.stdin })
 *   // A failure may land before `render` returns; honor the latch.
 *   if (pendingFailure) instance.unmount()
 *   await instance.waitUntilExit()
 * } finally {
 *   instance?.unmount()
 *   await input.close()
 * }
 * ```
 *
 * `render` sits inside the `try` so a throwing render still reaches
 * `close()`. The transport installs no global signal/exit listeners: Ctrl+C
 * remains Ink-driven and the host owns cleanup.
 *
 * The module is Windows-only and must not be imported eagerly by shared entry
 * points: the factory fails closed for unsupported platform/arch and for a
 * missing helper binary, and it never falls back to `dotnet` at runtime.
 *
 * A helper that has to be force-killed after the bounded stop wait cannot run
 * its own console-mode restoration; the transport writes that caveat to stderr
 * when it happens.
 */

/** File name of the native helper executable inside its arch directory. */
export const WINDOWS_INPUT_HELPER_EXECUTABLE = 'Runeframe.Win32Input.exe'

export interface WindowsInputTransportOptions {
  /**
   * Override the helper executable path (tests and non-standard layouts).
   * Defaults to the resolved `./binaries/win-<arch>/` asset next to this
   * module.
   */
  executablePath?: string
  /** Override platform detection (tests). */
  platform?: string
  /** Override architecture detection (tests). */
  arch?: string
  /** Injectable existence check (tests); defaults to `fs.existsSync`. */
  fileExists?: (path: string) => boolean
  /** Injectable spawn (tests); defaults to a hidden child process. */
  spawnHelper?: (executablePath: string) => WindowsHelperProcess
  /** Bounded wait for the helper's `ready` record. */
  readyTimeoutMs?: number
  /** Bounded graceful stop wait before a force kill. */
  stopTimeoutMs?: number
  /** Bounded wait after SIGTERM before SIGKILL. */
  killGraceMs?: number
  /**
   * Called exactly once when the helper's byte source terminates unexpectedly
   * after readiness: a post-ready helper error or stdout EOF, with EOF
   * surfaced as an `Error`. The callback runs after the shared multiplexer has
   * flushed held bytes, ended `stdin` and restored source raw mode, so the
   * host can report the failure and unmount Ink instead of sitting in a dead
   * fullscreen. Never called by a normal `close()`. A throwing callback is
   * swallowed so it cannot mask the failure or block teardown.
   */
  onInputFailure?: (error: Error) => void
  /** Warning sink; defaults to `process.stderr`. */
  stderr?: { write(chunk: string | Uint8Array): unknown }
}

/** Result of {@link createWindowsInputTransport}. */
export interface WindowsInputTransport {
  /**
   * Ink-facing input stream (the multiplexer's `stdin`): keyboard bytes only,
   * with mouse reports consumed upstream.
   */
  readonly stdin: NodeJS.ReadStream
  /** Normalized mouse reports translated from the helper's records. */
  readonly mouseEvents: MouseEventSource
  /**
   * Idempotent async teardown: mux dispose first, then the bounded native stop
   * (`stop\n`, bounded wait, force kill only as a last resort). Resolves once
   * the helper is gone.
   */
  close(): Promise<void>
}

/**
 * Resolve the helper executable for a platform/arch pair. The asset lives
 * next to this module (`./binaries/win-<arch>/Runeframe.Win32Input.exe`), so
 * it resolves both from the TypeScript source entry and from the emitted
 * `dist/windows-input.js` bundle. Returns `null` for unsupported targets.
 */
export function resolveWindowsInputExecutable(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform !== 'win32') return null
  if (arch !== 'x64' && arch !== 'arm64') return null
  return fileURLToPath(
    new URL(
      `./binaries/win-${arch}/${WINDOWS_INPUT_HELPER_EXECUTABLE}`,
      import.meta.url,
    ),
  )
}

/**
 * Wrap the host failure callback so it fires at most once per transport, even
 * if the multiplexer reports both an error and an end, and so a throwing host
 * callback cannot break the mux notification path or block teardown.
 */
function createInputFailureNotifier(
  onInputFailure: ((error: Error) => void) | undefined,
): (error: Error) => void {
  let notified = false
  return (error: Error): void => {
    if (notified) return
    notified = true
    if (onInputFailure === undefined) return
    try {
      onInputFailure(error)
    } catch {
      // Host callbacks must never mask the failure or block cleanup.
    }
  }
}

/**
 * Create the Windows input transport. Resolves once the helper reported ready;
 * rejects (fail closed, before any Ink usage) for unsupported platform/arch,
 * a missing helper binary, or a bounded startup failure after a graceful stop
 * attempt. No `dotnet` build or runtime fallback is ever attempted.
 */
export async function createWindowsInputTransport(
  options: WindowsInputTransportOptions = {},
): Promise<WindowsInputTransport> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const executablePath =
    options.executablePath ?? resolveWindowsInputExecutable(platform, arch)

  if (executablePath === null) {
    throw new Error(
      `runeframe windows input: unsupported platform/arch '${platform}/${arch}'; supported: win32/x64 and win32/arm64`,
    )
  }

  const fileExists = options.fileExists ?? existsSync
  if (!fileExists(executablePath)) {
    throw new Error(
      `runeframe windows input: helper executable not found at ${executablePath} for ${platform}/${arch}; no dotnet fallback is attempted`,
    )
  }

  const helper = await startWindowsHelperProcess(executablePath, {
    spawnHelper: options.spawnHelper,
    readyTimeoutMs: options.readyTimeoutMs,
    stopTimeoutMs: options.stopTimeoutMs,
    killGraceMs: options.killGraceMs,
    stderr: options.stderr,
  })

  let closing = false
  const notifyInputFailure = createInputFailureNotifier((error) => {
    if (closing) return
    options.onInputFailure?.(error)
  })

  // The multiplexer owns the only source subscription; these options are how
  // an unexpected post-ready source error or EOF becomes a visible failure
  // instead of a mounted Ink sitting on dead input.
  const mux = createSgrInputMultiplexer(helper.source, {
    onSourceError: (error) =>
      notifyInputFailure(
        error instanceof Error ? error : new Error(String(error)),
      ),
    // The byte source normally converts EOF into a visible error; this keeps a
    // clean source end visible too, always as an `Error`.
    onSourceEnd: () =>
      notifyInputFailure(
        new Error('windows input helper stdout ended unexpectedly'),
      ),
  })

  let closePromise: Promise<void> | null = null
  return {
    stdin: mux.stdin,
    mouseEvents: mux.mouseEvents,
    close(): Promise<void> {
      if (closePromise === null) {
        closing = true
        closePromise = (async () => {
          mux.dispose()
          await helper.stop()
        })()
      }
      return closePromise
    },
  }
}

export type { WindowsHelperProcess } from './transport.js'
export type {
  HelperErrorEvent,
  HelperEvent,
  HelperKeyEvent,
  HelperMouseEvent,
  HelperReadyEvent,
  HelperResizeEvent,
} from './protocol.js'
