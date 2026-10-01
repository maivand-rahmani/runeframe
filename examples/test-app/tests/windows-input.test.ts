import { describe, expect, it, vi } from 'vitest'
import {
  runInputHostLane,
  type HostInkInstance,
  type HostLaneTransport,
  type InputHostLaneOptions,
} from '../src/windows-input.js'

// These tests drive the host wiring with a mocked transport factory and a
// mocked Ink instance: no native helper, no real console and no process
// globals are touched. They pin the failure latch and the teardown order that
// `main.tsx` relies on (root transport tests already cover the transport's own
// callback-once/EOF/normal-close behavior).

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Minimal Ink instance double recording unmount/wait ordering. */
function createFakeInstance(
  events: string[],
  exit: Deferred<unknown> = deferred<unknown>(),
): HostInkInstance & { exit: Deferred<unknown>; unmounts: number } {
  const instance = {
    exit,
    unmounts: 0,
    unmount(): void {
      instance.unmounts += 1
      events.push('unmount')
      exit.resolve(undefined)
    },
    waitUntilExit(): Promise<unknown> {
      events.push('wait')
      return exit.promise
    },
  }
  return instance
}

/** Fake transport double: no streams, only a recorded close(). */
function createFakeTransport(events: string[]): HostLaneTransport & {
  closes: number
} {
  const transport = {
    closes: 0,
    stdin: {} as NodeJS.ReadStream,
    async close(): Promise<void> {
      transport.closes += 1
      events.push('close')
    },
  }
  return transport
}

interface LaneHarness {
  events: string[]
  stderrChunks: string[]
  exitCodes: number[]
  instance: ReturnType<typeof createFakeInstance>
  transport: ReturnType<typeof createFakeTransport>
  fail: (error: Error) => void
  renderCalls: number
  options: InputHostLaneOptions
}

/**
 * Build a lane whose transport factory captures the failure callback, whose
 * render records the call and returns a fake Ink instance, and whose stderr /
 * exit-code writes are captured instead of touching process globals.
 */
function createHarness(
  overrides: Partial<InputHostLaneOptions> = {},
  exit: Deferred<unknown> = deferred<unknown>(),
): LaneHarness {
  const events: string[] = []
  const stderrChunks: string[] = []
  const exitCodes: number[] = []
  const instance = createFakeInstance(events, exit)
  const transport = createFakeTransport(events)
  const harness: LaneHarness = {
    events,
    stderrChunks,
    exitCodes,
    instance,
    transport,
    fail: () => {
      throw new Error('createTransport has not been called yet')
    },
    renderCalls: 0,
    options: undefined as unknown as InputHostLaneOptions,
  }

  harness.options = {
    lane: 'windows',
    createTransport: async (onInputFailure) => {
      harness.fail = onInputFailure
      events.push('create')
      return transport
    },
    renderApp: () => {
      harness.renderCalls += 1
      events.push('render')
      return instance
    },
    stderr: {
      write: (chunk) => {
        stderrChunks.push(chunk)
        return true
      },
    },
    setExitCode: (code) => {
      exitCodes.push(code)
    },
    ...overrides,
  }

  return harness
}

describe('runInputHostLane teardown', () => {
  it('unmounts Ink before awaiting close on a normal exit', async () => {
    const harness = createHarness()
    const running = runInputHostLane(harness.options)
    await vi.waitFor(() => expect(harness.renderCalls).toBe(1))

    // Ctrl+C / app-driven unmount settles waitUntilExit, then the host closes.
    harness.instance.unmount()
    await running

    expect(harness.events).toEqual(['create', 'render', 'wait', 'unmount', 'unmount', 'close'])
    expect(harness.transport.closes).toBe(1)
    expect(harness.exitCodes).toEqual([])
    expect(harness.stderrChunks).toEqual([])
  })

  it('awaits close before resolving the lane', async () => {
    const events: string[] = []
    const transport = createFakeTransport(events)
    const closing = deferred<void>()
    transport.close = async () => {
      events.push('close-start')
      await closing.promise
      events.push('close-end')
    }
    const harness = createHarness({
      createTransport: async () => transport,
    })
    const running = runInputHostLane(harness.options)
    let settled = false
    void running.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(harness.renderCalls).toBe(1))
    harness.instance.unmount()
    await vi.waitFor(() => expect(events).toContain('close-start'))
    expect(settled).toBe(false)
    closing.resolve()
    await running
    expect(settled).toBe(true)
    expect(events).toContain('close-end')
  })

  it('still awaits close and propagates when the render throws', async () => {
    const harness = createHarness({
      renderApp: () => {
        throw new Error('render exploded')
      },
    })

    await expect(runInputHostLane(harness.options)).rejects.toThrow(
      'render exploded',
    )
    expect(harness.transport.closes).toBe(1)
    expect(harness.events).toEqual(['create', 'close'])
  })

  it('runs cleanup and propagates when waitUntilExit rejects', async () => {
    const exit = deferred<unknown>()
    const harness = createHarness({}, exit)
    const running = runInputHostLane(harness.options)
    await vi.waitFor(() => expect(harness.renderCalls).toBe(1))
    exit.reject(new Error('app exit failed'))

    await expect(running).rejects.toThrow('app exit failed')
    expect(harness.transport.closes).toBe(1)
    expect(harness.events).toContain('unmount')
  })
})

describe('runInputHostLane failure latch', () => {
  it('reports once, sets exit code 1, unmounts and closes on source failure', async () => {
    const harness = createHarness()
    const running = runInputHostLane(harness.options)
    await vi.waitFor(() => expect(harness.renderCalls).toBe(1))

    harness.fail(new Error('helper stdout ended unexpectedly'))
    // A lane may report both an error and an EOF; the latch reports once.
    harness.fail(new Error('second report must be ignored'))
    await running

    expect(harness.stderrChunks.join('')).toContain(
      'runeframe windows input: helper stdout ended unexpectedly; unmounting',
    )
    expect(harness.stderrChunks.join('')).not.toContain('second report')
    expect(harness.exitCodes).toEqual([1])
    expect(harness.transport.closes).toBe(1)
    // The latch unmounts immediately; teardown unmounts again (no-op).
    expect(harness.instance.unmounts).toBeGreaterThanOrEqual(1)
  })

  it('honors a failure that lands before render returns', async () => {
    const harness = createHarness({
      renderApp: () => {
        // Simulates a source that died while render was still mounting: the
        // callback fires before renderApp returns its instance.
        harness.fail(new Error('source died during mount'))
        harness.renderCalls += 1
        harness.events.push('render')
        return harness.instance
      },
    })

    await runInputHostLane(harness.options)

    expect(harness.stderrChunks.join('')).toContain('source died during mount')
    expect(harness.exitCodes).toEqual([1])
    // The post-render latch check unmounted; waitUntilExit was honored.
    expect(harness.events).toContain('unmount')
    expect(harness.events).toContain('close')
    expect(harness.transport.closes).toBe(1)
  })

  it('fails visibly and never renders or falls back when startup rejects', async () => {
    const harness = createHarness({
      createTransport: async () => {
        throw new Error('helper executable not found')
      },
    })

    await runInputHostLane(harness.options)

    expect(harness.renderCalls).toBe(0)
    expect(harness.transport.closes).toBe(0)
    expect(harness.exitCodes).toEqual([1])
    expect(harness.stderrChunks.join('')).toContain(
      'runeframe windows input: failed to start (helper executable not found)',
    )
  })
})
