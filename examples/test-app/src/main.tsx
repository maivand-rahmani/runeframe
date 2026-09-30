/**
 * Test-app entry point: start the single input owner before Ink renders and
 * run it for the whole app lifetime.
 *
 * Input ownership (no opt-in flags):
 * - Windows always uses the production `runeframe/windows-input` transport.
 *   The NativeAOT CONIN$ helper is the sole console input reader; its JSON
 *   records are translated into one byte stream which flows through the shared
 *   SGR multiplexer. Ink consumes `transport.stdin` (keyboard bytes only) and
 *   `ShowcaseApp` receives `transport.mouseEvents` (normalized reports), so the
 *   legacy post-Ink parser stays disabled and no second stdin listener exists.
 *   A startup failure is reported with exit code 1 and nothing renders.
 * - Every other platform keeps the plain `process.stdin` path and the legacy
 *   post-Ink mouse parsing; its transport close is a no-op.
 *
 * Failure/teardown contract (owned by `windows-input.ts`): a post-ready source
 * error/EOF is latched once — reported, exit code 1, Ink unmounted — and every
 * exit path (normal, Ctrl+C, render throw, source failure) runs
 * `instance?.unmount()` before `await transport.close()`. Startup failures are
 * visible and never fall back to `process.stdin` on Windows.
 */
import { render } from 'ink'
import { ShowcaseApp } from './App.js'
import {
  runInputHostLane,
  type HostInkInstance,
  type HostLaneTransport,
} from './windows-input.js'

async function main(): Promise<void> {
  /**
   * Render the app with the lane's stream. The Windows lane also supplies its
   * normalized mouse channel, which keeps the legacy post-Ink parser disabled.
   */
  const renderApp = (transport: HostLaneTransport): HostInkInstance =>
    render(<ShowcaseApp mouseEventSource={transport.mouseEvents} />, {
      stdin: transport.stdin,
      alternateScreen: true,
    })

  if (process.platform === 'win32') {
    await runInputHostLane({
      lane: 'windows',
      // Dynamic import so non-Windows runs never eagerly load the
      // Windows-only package entry; the alias maps it to the repository
      // transport source.
      createTransport: async (onInputFailure) => {
        const { createWindowsInputTransport } = await import(
          'runeframe/windows-input'
        )
        return createWindowsInputTransport({ onInputFailure })
      },
      renderApp,
    })
    return
  }

  // Default lane: the exact process.stdin path, no reader owned here.
  await runInputHostLane({
    lane: 'default',
    createTransport: async () => ({
      stdin: process.stdin,
      close: async () => {},
    }),
    renderApp,
  })
}

void main().catch((error: unknown) => {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`runeframe test app: fatal: ${detail}\n`)
  process.exitCode = 1
})
