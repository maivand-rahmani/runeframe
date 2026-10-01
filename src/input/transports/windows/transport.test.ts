import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  FORCE_KILL_CAVEAT,
  MAX_KEY_REPEAT,
  WINDOWS_CONTROL_STATE,
  WINDOWS_MOUSE_FLAGS,
  WINDOWS_VIRTUAL_KEYS,
  WindowsInputByteSource,
  createKeyTranslationState,
  createMouseTranslationState,
  scanCodeFallbackVirtualKey,
  startWindowsHelperProcess,
  translateKeyEvent,
  translateMouseEvent,
  type HelperProcessStdout,
  type WindowsHelperProcess,
} from './transport.js'
import {
  type HelperKeyEvent,
  type HelperMouseEvent,
} from './protocol.js'

// Synthetic tests only: a fake helper process stands in for the native child.
// Nothing here spawns a process, reads process.stdin or touches a console.

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

  emitProcessError(error: Error): void {
    this.emitter.emit('error', error)
  }

  emitStdoutError(error: Error): void {
    this.passThrough.emit('error', error)
  }
}

const READY_EVENT = { type: 'ready', originalMode: 0x01f0, mode: 0x0090 }

function keyEvent(overrides: Partial<HelperKeyEvent> = {}): HelperKeyEvent {
  return {
    type: 'key',
    down: true,
    repeat: 1,
    char: '',
    virtualKey: 0,
    virtualScanCode: null,
    control: 0,
    ...overrides,
  }
}

function mouseEvent(overrides: Partial<HelperMouseEvent> = {}): HelperMouseEvent {
  return {
    type: 'mouse',
    x: 0,
    y: 0,
    buttons: 0,
    flags: 0,
    control: 0,
    windowLeft: 0,
    windowTop: 0,
    ...overrides,
  }
}

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function collectStderr(): {
  chunks: string[]
  sink: { write(chunk: string | Uint8Array): unknown }
} {
  const chunks: string[] = []
  return {
    chunks,
    sink: {
      write: (chunk) => {
        chunks.push(
          typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
        )
        return true
      },
    },
  }
}

async function startSource(
  fake: FakeHelper = new FakeHelper(),
  options: {
    readyTimeoutMs?: number
    stopTimeoutMs?: number
    killGraceMs?: number
    stderr?: { write(chunk: string | Uint8Array): unknown }
  } = {},
): Promise<WindowsInputByteSource> {
  const source = new WindowsInputByteSource(fake, options)
  fake.writeEvent(READY_EVENT)
  await source.waitForReady()
  return source
}

// ── Key translation ───────────────────────────────────────────────────

describe('translateKeyEvent', () => {
  it('translates printable characters and key-up records', () => {
    expect(translateKeyEvent(keyEvent({ char: '4', virtualKey: 52 }))).toBe('4')
    expect(
      translateKeyEvent(keyEvent({ down: false, char: '4', virtualKey: 52 })),
    ).toBe('')
  })

  it('translates navigation virtual keys with xterm modifiers', () => {
    expect(
      translateKeyEvent(keyEvent({ virtualKey: WINDOWS_VIRTUAL_KEYS.RIGHT })),
    ).toBe('\u001B[C')
    expect(
      translateKeyEvent(
        keyEvent({
          virtualKey: WINDOWS_VIRTUAL_KEYS.LEFT,
          control: WINDOWS_CONTROL_STATE.SHIFT_PRESSED,
        }),
      ),
    ).toBe('\u001B[1;2D')
    expect(
      translateKeyEvent(
        keyEvent({
          virtualKey: WINDOWS_VIRTUAL_KEYS.DELETE,
          control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED,
        }),
      ),
    ).toBe('\u001B[3;5~')
  })

  it('recovers enhanced gray navigation keys from the scan code', () => {
    expect(scanCodeFallbackVirtualKey(0x48, WINDOWS_CONTROL_STATE.ENHANCED_KEY)).toBe(
      WINDOWS_VIRTUAL_KEYS.UP,
    )
    expect(scanCodeFallbackVirtualKey(0x48, 0)).toBeNull()
    expect(scanCodeFallbackVirtualKey(0, WINDOWS_CONTROL_STATE.ENHANCED_KEY)).toBeNull()
    expect(scanCodeFallbackVirtualKey(null, WINDOWS_CONTROL_STATE.ENHANCED_KEY)).toBeNull()
    expect(
      translateKeyEvent(
        keyEvent({
          virtualScanCode: 0x48,
          control: WINDOWS_CONTROL_STATE.ENHANCED_KEY,
        }),
      ),
    ).toBe('\u001B[A')
    expect(translateKeyEvent(keyEvent({ virtualScanCode: 0x48 }))).toBe('')
  })

  it('translates Ctrl+C and Ctrl+letter into control bytes', () => {
    expect(
      translateKeyEvent(
        keyEvent({ char: '\u0003', control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED }),
      ),
    ).toBe('\u0003')
    expect(
      translateKeyEvent(
        keyEvent({ char: 'c', control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED }),
      ),
    ).toBe('\u0003')
  })

  it('joins surrogate pairs across consecutive key events', () => {
    const state = createKeyTranslationState()
    expect(translateKeyEvent(keyEvent({ char: '\uD83D' }), state)).toBe('')
    expect(translateKeyEvent(keyEvent({ char: '\uDE80' }), state)).toBe('🚀')
    // An unpaired high surrogate is replaced, not dropped silently.
    expect(translateKeyEvent(keyEvent({ char: '\uD83D' }), state)).toBe('')
    expect(translateKeyEvent(keyEvent({ char: 'a' }), state)).toBe('\uFFFDa')
  })

  it('prefixes Alt, encodes Tab/Backspace/Escape and bounds repeats', () => {
    expect(
      translateKeyEvent(
        keyEvent({ char: 'a', control: WINDOWS_CONTROL_STATE.LEFT_ALT_PRESSED }),
      ),
    ).toBe('\u001Ba')
    expect(
      translateKeyEvent(
        keyEvent({
          virtualKey: WINDOWS_VIRTUAL_KEYS.TAB,
          control: WINDOWS_CONTROL_STATE.SHIFT_PRESSED,
        }),
      ),
    ).toBe('\u001B[Z')
    expect(
      translateKeyEvent(keyEvent({ virtualKey: WINDOWS_VIRTUAL_KEYS.BACK })),
    ).toBe('\u007F')
    expect(
      translateKeyEvent(keyEvent({ virtualKey: WINDOWS_VIRTUAL_KEYS.ESCAPE })),
    ).toBe('\u001B')
    expect(translateKeyEvent(keyEvent({ char: 'a', repeat: 1000 }))).toBe(
      'a'.repeat(MAX_KEY_REPEAT),
    )
  })
})

// ── Mouse translation ─────────────────────────────────────────────────

describe('translateMouseEvent', () => {
  it('reports left press and release edges with viewport mapping', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 4, y: 2, buttons: 1, windowLeft: 2, windowTop: 1 }),
        state,
      ),
    ).toBe('\u001B[<0;3;2M')
    expect(
      translateMouseEvent(
        mouseEvent({ x: 4, y: 2, buttons: 0, windowLeft: 2, windowTop: 1 }),
        state,
      ),
    ).toBe('\u001B[<0;3;2m')
  })

  it('reports vertical wheel with sign and modifiers', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 0x0078_0000, flags: WINDOWS_MOUSE_FLAGS.WHEELED }),
        state,
      ),
    ).toBe('\u001B[<64;2;2M')
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 0xff88_0000, flags: WINDOWS_MOUSE_FLAGS.WHEELED }),
        state,
      ),
    ).toBe('\u001B[<65;2;2M')
    expect(
      translateMouseEvent(
        mouseEvent({
          x: 1,
          y: 1,
          buttons: 0x0078_0000,
          flags: WINDOWS_MOUSE_FLAGS.WHEELED,
          control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED,
        }),
        state,
      ),
    ).toBe('\u001B[<80;2;2M')
  })

  it('reports held-left drag motion and keeps the release edge paired', () => {
    const state = createMouseTranslationState()
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 1 }), state)).toBe(
      '\u001B[<0;2;2M',
    )
    // Motion with the left button held is SGR motion in press form, not a
    // second press, and must not disturb the edge tracker.
    expect(
      translateMouseEvent(
        mouseEvent({ x: 2, y: 1, buttons: 1, flags: WINDOWS_MOUSE_FLAGS.MOVED }),
        state,
      ),
    ).toBe('\u001B[<32;3;2M')
    // The release edge is still detected and pairs with the press.
    expect(translateMouseEvent(mouseEvent({ x: 2, y: 1, buttons: 0 }), state)).toBe(
      '\u001B[<0;3;2m',
    )
  })

  it('does not pair a release when only motion was seen (no press edge)', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 1, flags: WINDOWS_MOUSE_FLAGS.MOVED }),
        state,
      ),
    ).toBe('\u001B[<32;2;2M')
    // No press edge was ever seen, so the idle record is not a release.
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 0 }), state)).toBeNull()
  })

  it('reports hover motion with no button and never synthesizes a click', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({
          x: 4,
          y: 2,
          buttons: 0,
          flags: WINDOWS_MOUSE_FLAGS.MOVED,
          windowLeft: 2,
          windowTop: 1,
        }),
        state,
      ),
    ).toBe('\u001B[<35;3;2M')
    // A hover move is not a press edge, so a later idle record cannot turn
    // into a release/click.
    expect(
      translateMouseEvent(
        mouseEvent({ x: 4, y: 2, buttons: 0, windowLeft: 2, windowTop: 1 }),
        state,
      ),
    ).toBeNull()
  })

  it('carries modifiers on drag and hover motion', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({
          x: 0,
          y: 0,
          buttons: 1,
          flags: WINDOWS_MOUSE_FLAGS.MOVED,
          control: WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED,
        }),
        state,
      ),
    ).toBe('\u001B[<48;1;1M')
    expect(
      translateMouseEvent(
        mouseEvent({
          x: 0,
          y: 0,
          buttons: 0,
          flags: WINDOWS_MOUSE_FLAGS.MOVED,
          control:
            WINDOWS_CONTROL_STATE.SHIFT_PRESSED |
            WINDOWS_CONTROL_STATE.LEFT_ALT_PRESSED,
        }),
        state,
      ),
    ).toBe('\u001B[<47;1;1M')
  })

  it('ignores motion outside the viewport without breaking release pairing', () => {
    const state = createMouseTranslationState()
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 1 }), state)).toBe(
      '\u001B[<0;2;2M',
    )
    // Drag motion outside the viewport origin is dropped by the shared bounds
    // check and must leave the edge tracker intact.
    expect(
      translateMouseEvent(
        mouseEvent({
          x: 0,
          y: 1,
          buttons: 1,
          flags: WINDOWS_MOUSE_FLAGS.MOVED,
          windowLeft: 2,
        }),
        state,
      ),
    ).toBeNull()
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 0 }), state)).toBe(
      '\u001B[<0;2;2m',
    )
  })

  it('ignores motion with only right/middle buttons held', () => {
    const state = createMouseTranslationState()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 2, flags: WINDOWS_MOUSE_FLAGS.MOVED }),
        state,
      ),
    ).toBeNull()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 6, flags: WINDOWS_MOUSE_FLAGS.MOVED }),
        state,
      ),
    ).toBeNull()
    // The ignored records leave the left edge tracker untouched.
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 1 }), state)).toBe(
      '\u001B[<0;2;2M',
    )
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 0 }), state)).toBe(
      '\u001B[<0;2;2m',
    )
  })

  it('ignores right/middle buttons, horizontal wheel and out-of-viewport points', () => {
    const state = createMouseTranslationState()
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 2 }), state)).toBeNull()
    expect(translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 4 }), state)).toBeNull()
    expect(
      translateMouseEvent(
        mouseEvent({ x: 1, y: 1, buttons: 1, flags: WINDOWS_MOUSE_FLAGS.HWHEELED }),
        state,
      ),
    ).toBeNull()
    expect(
      translateMouseEvent(mouseEvent({ x: 0, y: 1, buttons: 1, windowLeft: 2 }), state),
    ).toBeNull()
    expect(
      translateMouseEvent(mouseEvent({ x: 1, y: 1, buttons: 1, windowTop: 2 }), state),
    ).toBeNull()
  })
})

// ── Byte source ───────────────────────────────────────────────────────

describe('WindowsInputByteSource', () => {
  it('exposes bounded default timeouts', () => {
    expect(DEFAULT_READY_TIMEOUT_MS).toBe(10_000)
    expect(DEFAULT_STOP_TIMEOUT_MS).toBe(2_000)
    expect(DEFAULT_KILL_GRACE_MS).toBe(1_000)
  })

  it('resolves ready, translates records and tracks resize size', async () => {
    const fake = new FakeHelper()
    const source = await startSource(fake)
    expect(source.isTTY).toBe(true)
    expect(source.getSize()).toBeNull()

    const resizes: Array<{ columns: number; rows: number }> = []
    source.on('resize', () => {
      const size = source.getSize()
      if (size !== null) resizes.push(size)
    })

    const chunks: string[] = []
    source.on('data', (chunk: Buffer | string) => {
      chunks.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
    })

    fake.writeEvent({ type: 'resize', columns: 80, rows: 30 })
    fake.writeEvent({ type: 'key', down: true, repeat: 1, char: '4', virtualKey: 52, virtualScanCode: 5, control: 0 })
    fake.writeEvent({
      type: 'key',
      down: true,
      repeat: 1,
      char: '',
      virtualKey: WINDOWS_VIRTUAL_KEYS.RIGHT,
      virtualScanCode: 77,
      control: WINDOWS_CONTROL_STATE.ENHANCED_KEY,
    })
    await delay()

    expect(chunks.join('')).toBe('4\u001B[C')
    expect(resizes).toEqual([{ columns: 80, rows: 30 }])
    expect(source.getSize()).toEqual({ columns: 80, rows: 30 })

    const stopping = source.stop()
    fake.emitExit(0)
    await stopping
  })

  it('translates a split JSON line and ignores malformed lines', async () => {
    const fake = new FakeHelper()
    const source = await startSource(fake)
    const chunks: string[] = []
    source.on('data', (chunk: Buffer | string) => {
      chunks.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
    })

    const line = JSON.stringify({ type: 'key', down: true, repeat: 1, char: 'x', virtualKey: 88, virtualScanCode: 45, control: 0 })
    fake.writeRaw(line.slice(0, 12))
    await delay(5)
    expect(chunks.join('')).toBe('')
    fake.writeRaw(`${line.slice(12)}\n`)
    fake.writeRaw('not json\n')
    fake.writeRaw('{"type":"key","down":1,"char":"y"}\n')
    await delay()

    expect(chunks.join('')).toBe('x')

    const stopping = source.stop()
    fake.emitExit(0)
    await stopping
  })

  it('translates mouse records end to end: hover, drag motion, release', async () => {
    const fake = new FakeHelper()
    const source = await startSource(fake)
    const chunks: string[] = []
    source.on('data', (chunk: Buffer | string) => {
      chunks.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
    })

    fake.writeEvent({
      type: 'mouse',
      x: 3,
      y: 2,
      buttons: 0,
      flags: WINDOWS_MOUSE_FLAGS.MOVED,
      control: 0,
      windowLeft: 1,
      windowTop: 1,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 4,
      y: 2,
      buttons: 1,
      flags: 0,
      control: 0,
      windowLeft: 1,
      windowTop: 1,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 5,
      y: 2,
      buttons: 1,
      flags: WINDOWS_MOUSE_FLAGS.MOVED,
      control: WINDOWS_CONTROL_STATE.SHIFT_PRESSED,
      windowLeft: 1,
      windowTop: 1,
    })
    fake.writeEvent({
      type: 'mouse',
      x: 5,
      y: 2,
      buttons: 0,
      flags: 0,
      control: 0,
      windowLeft: 1,
      windowTop: 1,
    })
    await delay()

    expect(chunks.join('')).toBe(
      '\u001B[<35;3;2M\u001B[<0;4;2M\u001B[<36;5;2M\u001B[<0;5;2m',
    )

    const stopping = source.stop()
    fake.emitExit(0)
    await stopping
  })

  it('records raw-mode requests without touching process.stdin', () => {
    const dataBefore = process.stdin.listenerCount('data')
    const readableBefore = process.stdin.listenerCount('readable')
    const fake = new FakeHelper()
    const source = new WindowsInputByteSource(fake)
    fake.writeEvent(READY_EVENT)

    source.setRawMode(true)
    expect(source.isRawModeEnabled).toBe(true)
    source.setRawMode(false)
    expect(source.isRawModeEnabled).toBe(false)
    expect(source).not.toBe(process.stdin)
    expect(process.stdin.listenerCount('data')).toBe(dataBefore)
    expect(process.stdin.listenerCount('readable')).toBe(readableBefore)

    source.ref()
    source.unref()
    expect(fake.calls.ref).toBe(1)
    expect(fake.calls.unref).toBe(1)
  })

  it('pauses the helper stdout on backpressure and resumes on read demand', async () => {
    const fake = new FakeHelper()
    const source = await startSource(fake)

    source.pushInput('a'.repeat(256 * 1024))
    expect(fake.calls.pause).toBeGreaterThan(0)

    // Draining the readable releases the pause through `_read`.
    const drained = source.read() as Buffer
    expect(Buffer.isBuffer(drained)).toBe(true)
    await delay()
    expect(fake.calls.resume).toBeGreaterThan(0)

    const stopping = source.stop()
    fake.emitExit(0)
    await stopping
  })

  it('rejects readiness on early exit and on timeout', async () => {
    const earlyFake = new FakeHelper()
    const early = new WindowsInputByteSource(earlyFake, { readyTimeoutMs: 1_000 })
    const earlyFailure = expect(early.waitForReady()).rejects.toThrow(
      'exited before ready',
    )
    earlyFake.emitExit(1)
    await earlyFailure

    const slowFake = new FakeHelper()
    const slow = new WindowsInputByteSource(slowFake, {
      readyTimeoutMs: 20,
      stopTimeoutMs: 50,
      killGraceMs: 20,
    })
    const timeoutFailure = expect(slow.waitForReady()).rejects.toThrow(
      'did not report ready',
    )
    await delay(40)
    slowFake.emitExit(1)
    await timeoutFailure
    expect(slowFake.written).toEqual(['stop\n'])
  })

  it('fails visibly on a protocol line over the cap and closes the stream', async () => {
    const { chunks, sink } = collectStderr()
    const fake = new FakeHelper()
    const source = await startSource(fake, { stderr: sink })
    const closed = new Promise<void>((resolve) => {
      source.on('close', () => resolve())
    })

    fake.writeRaw('x'.repeat(64 * 1024 + 1))
    source.resume()
    await closed

    expect(chunks.join('')).toContain('protocol line exceeded')
    expect(chunks.join('')).toContain('runeframe windows input:')
  })

  it('surfaces an unexpected helper exit and closes the stream', async () => {
    const { chunks, sink } = collectStderr()
    const fake = new FakeHelper()
    const source = await startSource(fake, { stderr: sink })
    const closed = new Promise<void>((resolve) => {
      source.on('close', () => resolve())
    })

    fake.emitExit(1, null)
    source.resume()
    await closed

    expect(chunks.join('')).toContain('exited unexpectedly (code 1)')
    expect(source.isRawModeEnabled).toBe(false)
  })

  it('stops gracefully once and writes the force-kill caveat when the helper hangs', async () => {
    const { chunks, sink } = collectStderr()
    const fake = new FakeHelper()
    const source = await startSource(fake, {
      stopTimeoutMs: 30,
      killGraceMs: 20,
      stderr: sink,
    })

    await source.stop()
    expect(fake.written).toEqual(['stop\n'])
    expect(fake.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(chunks.join('')).toContain(FORCE_KILL_CAVEAT)
    expect(chunks.join('')).toContain('not guaranteed')

    // Idempotent: a second stop never re-requests or re-kills.
    await source.stop()
    expect(fake.written).toEqual(['stop\n'])
    expect(fake.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('propagates spawn failures with a clear message', async () => {
    await expect(
      startWindowsHelperProcess('C:\\virtual\\Runeframe.Win32Input.exe', {
        spawnHelper: () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('failed to spawn the Windows input helper: boom')
  })
})
