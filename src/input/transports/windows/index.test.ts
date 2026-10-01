import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, useInput, type Key } from 'ink'
import {
  createWindowsInputTransport,
  resolveWindowsInputExecutable,
  type WindowsInputTransport,
  type WindowsInputTransportOptions,
} from './index.js'
import {
  WINDOWS_CONTROL_STATE,
  WINDOWS_MOUSE_FLAGS,
  WINDOWS_VIRTUAL_KEYS,
  type HelperProcessStdout,
  type WindowsHelperProcess,
} from './transport.js'
import type { NormalizedMouseEvent } from '../../../interaction/mouse/SgrMouseStreamParser.js'

// Synthetic tests only: the helper child is always injected, no process is
// spawned, and the Ink render uses a fake TTY. Physical input is not claimed.

/**
 * Records what the transport passes to the shared multiplexer while delegating
 * to the real implementation, so the option wiring and the single source
 * subscription can be asserted directly.
 */
const muxSpy = vi.hoisted(() => ({
  sources: [] as NodeJS.ReadStream[],
  options: [] as Array<
    | {
        onSourceError?: (error: unknown) => void
        onSourceEnd?: () => void
      }
    | undefined
  >,
}))

vi.mock(
  '../../../interaction/mouse/SgrInputMultiplexer.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../interaction/mouse/SgrInputMultiplexer.js')
      >()
    return {
      ...actual,
      createSgrInputMultiplexer: (
        source: Parameters<typeof actual.createSgrInputMultiplexer>[0],
        options?: Parameters<typeof actual.createSgrInputMultiplexer>[1],
      ) => {
        muxSpy.sources.push(source)
        muxSpy.options.push(options)
        return actual.createSgrInputMultiplexer(source, options)
      },
    }
  },
)

type HelperListener = (...args: any[]) => void

class FakeHelper implements WindowsHelperProcess {
  readonly passThrough = new PassThrough()
  readonly written: string[] = []
  readonly kills: string[] = []
  readonly calls = { pause: 0, resume: 0, ref: 0, unref: 0 }
  exitCode: number | null = null

  readonly stdout = {
    setEncoding: (): void => {},
    on: (event: string, listener: HelperListener): void => {
      this.passThrough.on(event, listener)
    },
    removeListener: (event: string, listener: HelperListener): void => {
      this.passThrough.removeListener(event, listener)
    },
    pause: (): void => {
      this.calls.pause += 1
      this.passThrough.pause()
    },
    resume: (): void => {
      this.calls.resume += 1
      this.passThrough.resume()
    },
    ref: (): void => {
      this.calls.ref += 1
    },
    unref: (): void => {
      this.calls.unref += 1
    },
  } as HelperProcessStdout

  readonly stdin = {
    write: (chunk: string): boolean => {
      this.written.push(chunk)
      return true
    },
    end: (): void => {},
    on: (_event: string, _listener: HelperListener): void => {},
  }

  private readonly emitter = new EventEmitter()

  on(event: string, listener: HelperListener): this {
    this.emitter.on(event, listener)
    return this
  }

  once(event: string, listener: HelperListener): this {
    this.emitter.once(event, listener)
    return this
  }

  removeListener(event: string, listener: HelperListener): this {
    this.emitter.removeListener(event, listener)
    return this
  }

  kill(signal?: string): boolean {
    this.kills.push(signal ?? 'SIGTERM')
    return true
  }

  writeEvent(event: Record<string, unknown>): void {
    this.passThrough.write(`${JSON.stringify(event)}\n`)
  }

  writeRaw(text: string): void {
    this.passThrough.write(text)
  }

  emitExit(code: number | null = null, signal: string | null = null): void {
    this.exitCode = code
    this.emitter.emit('exit', code, signal)
  }
}

const READY_EVENT = { type: 'ready', originalMode: 0x01f0, mode: 0x0090 }

class FakeOutput extends EventEmitter {
  isTTY = true
  columns = 80
  rows = 24
  destroyed = false
  writableEnded = false
  writable = true
  writes: string[] = []

  write = (data: string): boolean => {
    this.writes.push(data)
    return true
  }

  getColorDepth(): number {
    return 1
  }

  hasColors(): boolean {
    return false
  }
}

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createWithFake(
  overrides: Partial<WindowsInputTransportOptions> = {},
): Promise<{
  fake: FakeHelper
  transport: WindowsInputTransport
}> {
  const fake = new FakeHelper()
  const started = createWindowsInputTransport({
    platform: 'win32',
    arch: 'x64',
    executablePath: 'C:\\virtual\\binaries\\win-x64\\Runeframe.Win32Input.exe',
    fileExists: () => true,
    spawnHelper: () => fake,
    readyTimeoutMs: 1_000,
    stopTimeoutMs: 200,
    killGraceMs: 100,
    stderr: { write: () => true },
    ...overrides,
  })
  fake.writeEvent(READY_EVENT)
  const transport = await started
  return { fake, transport }
}

function renderProbe(
  transport: WindowsInputTransport,
  onInput: (input: string, key: Key) => void,
): ReturnType<typeof render> {
  function Probe(): null {
    useInput((input, key) => onInput(input, key))
    return null
  }

  const output = new FakeOutput()
  return render(createElement(Probe), {
    stdin: transport.stdin,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: true,
  })
}

describe('resolveWindowsInputExecutable', () => {
  it('resolves win-x64 and win-arm64 assets relative to this module', () => {
    const x64 = resolveWindowsInputExecutable('win32', 'x64')
    expect(x64).not.toBeNull()
    expect(x64).toContain('binaries')
    expect(x64).toContain('win-x64')
    expect(x64).toContain('Runeframe.Win32Input.exe')

    const arm64 = resolveWindowsInputExecutable('win32', 'arm64')
    expect(arm64).not.toBeNull()
    expect(arm64).toContain('win-arm64')
  })

  it('fails closed for unsupported platforms and architectures', () => {
    expect(resolveWindowsInputExecutable('darwin', 'arm64')).toBeNull()
    expect(resolveWindowsInputExecutable('linux', 'x64')).toBeNull()
    expect(resolveWindowsInputExecutable('win32', 'ia32')).toBeNull()
  })
})

describe('createWindowsInputTransport', () => {
  it('fails closed before spawning on unsupported platform/arch', async () => {
    let spawned = 0
    await expect(
      createWindowsInputTransport({
        platform: 'darwin',
        arch: 'arm64',
        spawnHelper: () => {
          spawned += 1
          return new FakeHelper()
        },
      }),
    ).rejects.toThrow('unsupported platform/arch')
    expect(spawned).toBe(0)
  })

  it('fails closed before spawning when the helper binary is missing', async () => {
    let spawned = 0
    await expect(
      createWindowsInputTransport({
        platform: 'win32',
        arch: 'x64',
        executablePath: 'C:\\virtual\\missing\\Runeframe.Win32Input.exe',
        fileExists: () => false,
        spawnHelper: () => {
          spawned += 1
          return new FakeHelper()
        },
      }),
    ).rejects.toThrow('helper executable not found')
    expect(spawned).toBe(0)
  })

  it('rejects a bounded startup timeout after a graceful stop attempt', async () => {
    const fake = new FakeHelper()
    const started = createWindowsInputTransport({
      platform: 'win32',
      arch: 'x64',
      executablePath: 'C:\\virtual\\Runeframe.Win32Input.exe',
      fileExists: () => true,
      spawnHelper: () => fake,
      readyTimeoutMs: 20,
      stopTimeoutMs: 50,
      killGraceMs: 20,
      stderr: { write: () => true },
    })
    const failure = expect(started).rejects.toThrow('did not report ready')
    await delay(40)
    fake.emitExit(1)
    await failure
    expect(fake.written).toEqual(['stop\n'])
    expect(fake.kills).toEqual([])
  })

  it('drives real Ink keyboard input and publishes normalized mouse events', async () => {
    const { fake, transport } = await createWithFake()
    const stdinDataBefore = process.stdin.listenerCount('data')
    const stdinReadableBefore = process.stdin.listenerCount('readable')
    const inputs: Array<{ input: string; key: Key }> = []
    const mouseEvents: NormalizedMouseEvent[] = []

    const instance = renderProbe(transport, (input, key) => {
      inputs.push({ input, key })
    })
    await delay(30)

    // Malformed lines are ignored and a resize record is tolerated; neither
    // disturbs the records that follow.
    fake.writeRaw('garbage\n')
    fake.writeRaw('{"type":"resize","columns":80,"rows":30}\n')
    fake.writeEvent({
      type: 'key',
      down: true,
      repeat: 1,
      char: '4',
      virtualKey: 52,
      virtualScanCode: 5,
      control: 0,
    })
    await vi.waitFor(() => expect(inputs.map((entry) => entry.input)).toContain('4'), {
      timeout: 2_000,
      interval: 10,
    })

    // Enhanced gray navigation key recovered from the scan code.
    fake.writeEvent({
      type: 'key',
      down: true,
      repeat: 1,
      char: '',
      virtualKey: 0,
      virtualScanCode: 0x48,
      control: WINDOWS_CONTROL_STATE.ENHANCED_KEY,
    })
    await vi.waitFor(
      () => expect(inputs.some((entry) => entry.key.upArrow)).toBe(true),
      { timeout: 2_000, interval: 10 },
    )

    // Ctrl+C arrives as a control byte and Ink reports ctrl+c.
    fake.writeEvent({
      type: 'key',
      down: true,
      repeat: 1,
      char: '\u0003',
      virtualKey: 67,
      virtualScanCode: 46,
      control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED,
    })
    await vi.waitFor(
      () =>
        expect(
          inputs.some((entry) => entry.input === 'c' && entry.key.ctrl),
        ).toBe(true),
      { timeout: 2_000, interval: 10 },
    )

    // Surrogate pairs are joined across records; the second record is split
    // across two JSON chunks.
    const lowHalf = JSON.stringify({
      type: 'key',
      down: true,
      repeat: 1,
      char: '\uDE80',
      virtualKey: 0,
      virtualScanCode: null,
      control: 0,
    })
    fake.writeEvent({
      type: 'key',
      down: true,
      repeat: 1,
      char: '\uD83D',
      virtualKey: 0,
      virtualScanCode: null,
      control: 0,
    })
    fake.writeRaw(lowHalf.slice(0, 10))
    await delay(5)
    fake.writeRaw(`${lowHalf.slice(10)}\n`)
    await vi.waitFor(
      () => expect(inputs.some((entry) => entry.input === '🚀')).toBe(true),
      { timeout: 2_000, interval: 10 },
    )

    // Mouse records become normalized events; they never reach Ink.
    const beforeMouseInputs = inputs.length
    transport.mouseEvents.subscribe((event) => mouseEvents.push(event))
    fake.writeEvent({
      type: 'mouse',
      x: 4,
      y: 2,
      buttons: 1,
      flags: 0,
      control: 0,
      windowLeft: 2,
      windowTop: 1,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 4,
      y: 2,
      buttons: 0,
      flags: 0,
      control: 0,
      windowLeft: 2,
      windowTop: 1,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 4,
      y: 2,
      buttons: 0x0078_0000,
      flags: WINDOWS_MOUSE_FLAGS.WHEELED,
      control: 0,
      windowLeft: 2,
      windowTop: 1,
    })
    await vi.waitFor(() => expect(mouseEvents).toHaveLength(3), {
      timeout: 2_000,
      interval: 10,
    })
    expect(mouseEvents[0]).toMatchObject({
      type: 'press',
      button: 'left',
      x: 2,
      y: 1,
    })
    expect(mouseEvents[1]).toMatchObject({
      type: 'release',
      button: 'left',
      x: 2,
      y: 1,
    })
    expect(mouseEvents[2]).toMatchObject({ type: 'wheel', direction: 'up' })
    await delay(20)
    expect(inputs).toHaveLength(beforeMouseInputs)
    expect(inputs.some((entry) => entry.input.includes('[<'))).toBe(false)

    // The helper stream is the only source; process.stdin is untouched.
    expect(transport.stdin).not.toBe(process.stdin)
    expect(process.stdin.listenerCount('data')).toBe(stdinDataBefore)
    expect(process.stdin.listenerCount('readable')).toBe(stdinReadableBefore)

    const exited = instance.waitUntilExit()
    instance.unmount()
    await exited

    // Idempotent close: mux dispose then one graceful stop.
    const closing = transport.close()
    const closingAgain = transport.close()
    fake.emitExit(0)
    await Promise.all([closing, closingAgain])
    expect(fake.written).toEqual(['stop\n'])
    expect(fake.kills).toEqual([])
  })

  it('buffers early mouse records until the first subscriber (pre-subscription queue)', async () => {
    const { fake, transport } = await createWithFake()

    // Records arrive before anyone subscribes; the multiplexer must hold them
    // for the first real subscriber instead of dropping them.
    fake.writeEvent({
      type: 'mouse',
      x: 3,
      y: 1,
      buttons: 1,
      flags: 0,
      control: 0,
      windowLeft: 0,
      windowTop: 0,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 3,
      y: 1,
      buttons: 0,
      flags: 0,
      control: 0,
      windowLeft: 0,
      windowTop: 0,
    })
    await delay(20)

    const events: NormalizedMouseEvent[] = []
    transport.mouseEvents.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(events).toHaveLength(2), {
      timeout: 2_000,
      interval: 10,
    })
    expect(events[0]).toMatchObject({ type: 'press', button: 'left', x: 3, y: 1 })
    expect(events[1]).toMatchObject({ type: 'release', button: 'left' })

    const closing = transport.close()
    fake.emitExit(0)
    await closing
  })

  it('passes backpressure through to the helper stdout and resumes on drain', async () => {
    const { fake, transport } = await createWithFake()

    // Enough keyboard bytes to fill the multiplexer buffer with no consumer.
    const record = JSON.stringify({
      type: 'key',
      down: true,
      repeat: 64,
      char: 'a',
      virtualKey: 65,
      virtualScanCode: 30,
      control: 0,
    })
    for (let index = 0; index < 2_000; index += 1) {
      fake.writeRaw(`${record}\n`)
    }
    await vi.waitFor(() => expect(fake.calls.pause).toBeGreaterThan(0), {
      timeout: 2_000,
      interval: 10,
    })

    // A consumer releases the pause through read demand.
    const chunks: Buffer[] = []
    transport.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    await vi.waitFor(() => expect(fake.calls.resume).toBeGreaterThan(0), {
      timeout: 2_000,
      interval: 10,
    })
    expect(Buffer.concat(chunks).length).toBe(2_000 * 64)

    const closing = transport.close()
    fake.emitExit(0)
    await closing
  })

  it('surfaces an unexpected helper exit and ends the Ink stream', async () => {
    const stderrChunks: string[] = []
    const fake = new FakeHelper()
    const started = createWindowsInputTransport({
      platform: 'win32',
      arch: 'x64',
      executablePath: 'C:\\virtual\\Runeframe.Win32Input.exe',
      fileExists: () => true,
      spawnHelper: () => fake,
      readyTimeoutMs: 1_000,
      stopTimeoutMs: 200,
      killGraceMs: 100,
      stderr: {
        write: (chunk) => {
          stderrChunks.push(
            typeof chunk === 'string'
              ? chunk
              : Buffer.from(chunk).toString('utf8'),
          )
          return true
        },
      },
    })
    fake.writeEvent(READY_EVENT)
    const transport = await started

    const ended = new Promise<void>((resolve) => {
      transport.stdin.on('end', () => resolve())
    })
    transport.stdin.resume()
    fake.emitExit(1, null)
    await ended

    expect(stderrChunks.join('')).toContain('exited unexpectedly')
    expect(stderrChunks.join('')).toContain('runeframe windows input:')
    await transport.close()
    expect(fake.kills).toEqual([])
  })
})

describe('onInputFailure', () => {
  it('calls it exactly once on an unexpected helper exit and unmounts Ink', async () => {
    const failures: Error[] = []
    let instance: ReturnType<typeof render> | undefined
    const { fake, transport } = await createWithFake({
      onInputFailure: (error) => {
        failures.push(error)
        instance?.unmount()
      },
    })

    instance = renderProbe(transport, () => {})
    await delay(30)
    const exited = instance.waitUntilExit()
    fake.emitExit(1, null)
    await exited

    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[0].message).toContain('exited unexpectedly')

    // The helper is already gone: close resolves without a force kill.
    await transport.close()
    expect(fake.kills).toEqual([])
    expect(failures).toHaveLength(1)
  })

  it('calls it exactly once on an unexpected stdout EOF (surfaced as Error)', async () => {
    const failures: Error[] = []
    let instance: ReturnType<typeof render> | undefined
    const { fake, transport } = await createWithFake({
      onInputFailure: (error) => {
        failures.push(error)
        instance?.unmount()
      },
    })

    instance = renderProbe(transport, () => {})
    await delay(30)
    const exited = instance.waitUntilExit()

    fake.passThrough.end()
    await vi.waitFor(() => expect(fake.written).toEqual(['stop\n']), {
      timeout: 2_000,
      interval: 10,
    })
    fake.emitExit(0)
    await exited

    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[0].message).toContain('stdout ended unexpectedly')
    await transport.close()
    expect(fake.kills).toEqual([])
    expect(failures).toHaveLength(1)
  })

  it('latches a failure that lands before the host renders', async () => {
    const failures: Error[] = []
    let pendingFailure: Error | undefined
    let instance: ReturnType<typeof render> | undefined
    const { fake, transport } = await createWithFake({
      onInputFailure: (error) => {
        failures.push(error)
        pendingFailure = error
        instance?.unmount()
      },
    })

    fake.emitExit(1, null)
    await vi.waitFor(() => expect(pendingFailure).toBeInstanceOf(Error), {
      timeout: 2_000,
      interval: 10,
    })
    expect(instance).toBeUndefined()
    expect(failures).toHaveLength(1)

    // The documented host pattern: render, then honor the latch immediately.
    instance = renderProbe(transport, () => {})
    if (pendingFailure) instance.unmount()
    await instance.waitUntilExit()

    await transport.close()
    expect(failures).toHaveLength(1)
    expect(fake.kills).toEqual([])
  })

  it('is never called by a normal close', async () => {
    const failures: Error[] = []
    const { fake, transport } = await createWithFake({
      onInputFailure: (error) => failures.push(error),
    })

    const instance = renderProbe(transport, () => {})
    await delay(20)
    const exited = instance.waitUntilExit()
    instance.unmount()
    await exited

    const closing = transport.close()
    fake.emitExit(0)
    await closing
    await delay(20)

    expect(failures).toHaveLength(0)
    expect(fake.written).toEqual(['stop\n'])
    expect(fake.kills).toEqual([])
  })

  it('swallows a throwing callback and still tears down cleanly', async () => {
    const stderrChunks: string[] = []
    const { fake, transport } = await createWithFake({
      onInputFailure: () => {
        throw new Error('host callback exploded')
      },
      stderr: {
        write: (chunk) => {
          stderrChunks.push(
            typeof chunk === 'string'
              ? chunk
              : Buffer.from(chunk).toString('utf8'),
          )
          return true
        },
      },
    })

    const ended = new Promise<void>((resolve) => {
      transport.stdin.on('end', () => resolve())
    })
    transport.stdin.resume()
    fake.emitExit(1, null)
    await ended

    expect(stderrChunks.join('')).toContain('exited unexpectedly')

    const closing = transport.close()
    await closing
    expect(fake.kills).toEqual([])
  })

  it('passes onSourceError/onSourceEnd to the mux and keeps one data listener', async () => {
    const failures: Error[] = []
    const { fake, transport } = await createWithFake({
      onInputFailure: (error) => failures.push(error),
    })

    const source = muxSpy.sources.at(-1)
    const options = muxSpy.options.at(-1)
    expect(source).toBeDefined()
    expect(typeof options?.onSourceError).toBe('function')
    expect(typeof options?.onSourceEnd).toBe('function')
    // Sole consumer: exactly one `data` subscription on the helper source.
    expect(source?.listenerCount('data')).toBe(1)

    // A clean EOF is surfaced as an Error through the same callback.
    options?.onSourceEnd?.()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
    expect(failures[0].message).toContain('stdout ended unexpectedly')

    // A following source error cannot produce a second notification.
    options?.onSourceError?.(new Error('late source error'))
    expect(failures).toHaveLength(1)

    const closing = transport.close()
    fake.emitExit(0)
    await closing
    expect(source?.listenerCount('data')).toBe(0)
  })
})
