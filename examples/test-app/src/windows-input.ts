/**
 * Host wiring for the test app's single input owner.
 *
 * The entry point resolves one lane before Ink renders and hands it to
 * {@link runInputHostLane}, which owns the whole lifecycle:
 *
 *  - Windows (always, no opt-in): the production `runeframe/windows-input`
 *    transport is created before `render` and is the sole console input
 *    reader. `main.tsx` supplies the factory via a dynamic import so
 *    non-Windows runs never eagerly load the Windows-only package entry.
 *  - Non-Windows: plain `process.stdin`, exposed through the same transport
 *    contract with a no-op close.
 *
 * Guarantees provided here, so no lane has to re-implement them:
 *
 *  - a post-ready source failure (`onInputFailure`) is latched once: the error
 *    is reported, `exitCode` becomes 1, and Ink is unmounted if it is already
 *    mounted (a failure that lands before `render` returns is honored right
 *    after it);
 *  - startup failure is visible: report + exit code 1, no render, and never a
 *    fallback to `process.stdin` on Windows;
 *  - teardown always runs `instance?.unmount()` first and then awaits
 *    `transport.close()` — for normal exit, Ctrl+C, a throwing render and a
 *    source failure alike — so no unawaited cleanup chain is left behind;
 *  - a `waitUntilExit()` rejection is not swallowed: cleanup runs, then the
 *    error propagates to the entry point.
 *
 * This module deliberately does not import `runeframe/windows-input` itself;
 * the Windows factory stays a dynamic import owned by the entry point.
 */
import type { FrameworkProviderProps } from 'runeframe'

/** Minimal Ink instance surface the host relies on. */
export interface HostInkInstance {
  /** Manually unmount the whole Ink app. Idempotent for this host's purpose. */
  unmount(): void
  /** Settles when the app is unmounted (Ctrl+C included). */
  waitUntilExit(): Promise<unknown>
}

/** The input-owner contract every lane exposes to the host. */
export interface HostLaneTransport {
  /** Ink-facing input stream for this lane. */
  readonly stdin: NodeJS.ReadStream
  /**
   * Normalized mouse channel forwarded to `ShowcaseApp`, when the lane has
   * one. Omitted on the plain `process.stdin` default lane, which keeps the
   * legacy post-Ink mouse parsing.
   */
  readonly mouseEvents?: FrameworkProviderProps['mouseEventSource']
  /**
   * Idempotent async teardown of the lane's reader. Resolves once the reader
   * released the console/stream.
   */
  close(): Promise<void>
}

export interface InputHostLaneOptions {
  /** Lane name used in stderr reports: `windows`, `sgr` or `default`. */
  lane: string
  /**
   * Start the lane before Ink renders. Rejection is a visible startup failure:
   * the host reports it, sets exit code 1 and never renders or falls back.
   * The callback must be invoked at most once for an unexpected post-ready
   * source error/EOF.
   */
  createTransport(
    onInputFailure: (error: Error) => void,
  ): Promise<HostLaneTransport>
  /**
   * Render the app with the lane's stdin/channel. Called inside the teardown
   * guard, so a throwing render still reaches `close()`.
   */
  renderApp(transport: HostLaneTransport): HostInkInstance
  /** Report sink; defaults to `process.stderr`. */
  stderr?: { write(chunk: string): unknown }
  /** Exit-code setter; defaults to assigning `process.exitCode`. */
  setExitCode?: (code: number) => void
}

/**
 * Run one input lane for the app lifetime.
 *
 * See the module header for the exact failure and teardown guarantees.
 */
export async function runInputHostLane(
  options: InputHostLaneOptions,
): Promise<void> {
  const stderr = options.stderr ?? process.stderr
  const setExitCode =
    options.setExitCode ??
    ((code: number): void => {
      process.exitCode = code
    })

  let instance: HostInkInstance | null = null
  let failure: Error | null = null

  const onInputFailure = (error: Error): void => {
    // Latch once: a lane may report both an error and an EOF.
    if (failure !== null) return
    failure = error
    setExitCode(1)
    try {
      stderr.write(
        `runeframe ${options.lane} input: ${error.message}; unmounting so ` +
          'the app cannot sit in a dead fullscreen\n',
      )
    } catch {
      // Reporting must never block the unmount.
    }
    instance?.unmount()
  }

  let transport: HostLaneTransport
  try {
    transport = await options.createTransport(onInputFailure)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setExitCode(1)
    try {
      stderr.write(
        `runeframe ${options.lane} input: failed to start (${message})\n`,
      )
    } catch {
      // Reporting must never mask the startup failure.
    }
    // Fail closed: no render and no fallback reader for this lane.
    return
  }

  try {
    instance = options.renderApp(transport)
    // A source failure may land before `render` returns; honor the latch.
    if (failure !== null) instance.unmount()
    await instance.waitUntilExit()
  } finally {
    // Ink must be unmounted before the transport releases the console/stream.
    instance?.unmount()
    await transport.close()
  }
}
