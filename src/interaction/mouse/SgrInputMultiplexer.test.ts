import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render as inkRender, Text, useInput, type Key } from 'ink'
import {
  DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS,
  MAX_PENDING_MOUSE_EVENTS,
  createSgrInputMultiplexer,
  type SgrInputMultiplexer,
  type SgrInputMultiplexerOptions,
} from './SgrInputMultiplexer.js'
import type { NormalizedMouseEvent } from './SgrMouseStreamParser.js'

const ESC = '\u001b'

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Let pending stream reads and nextTick emissions settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function ascii(text: string): Buffer {
  return Buffer.from(text, 'latin1')
}

function left(
  type: 'press' | 'release',
  x: number,
  y: number,
): NormalizedMouseEvent {
  return { type, button: 'left', x, y, shift: false, alt: false, ctrl: false }
}

function wheel(
  direction: 'up' | 'down',
  x: number,
  y: number,
): NormalizedMouseEvent {
  return { type: 'wheel', direction, x, y, shift: false, alt: false, ctrl: false }
}

const PRESS_BYTES = ascii(`${ESC}[<0;12;7M`)
const RELEASE_BYTES = ascii(`${ESC}[<0;12;7m`)
const WHEEL_BYTES = ascii(`${ESC}[<64;3;4M`)
const ARROW_BYTES = ascii(`${ESC}[A`)
const UNICODE_BYTES = Buffer.from('héllo🚀', 'utf8')
const TAIL_BYTES = Buffer.from('q', 'utf8')

const MIXED = Buffer.concat([
  ARROW_BYTES,
  UNICODE_BYTES,
  PRESS_BYTES,
  TAIL_BYTES,
  WHEEL_BYTES,
  RELEASE_BYTES,
])
const MIXED_KEYBOARD = Buffer.concat([ARROW_BYTES, UNICODE_BYTES, TAIL_BYTES])
const MIXED_EVENTS: NormalizedMouseEvent[] = [
  left('press', 11, 6),
  wheel('up', 2, 3),
  left('release', 11, 6),
]

/** Byte source stand-in for `process.stdin`, recording the Node surface. */
class FakeSource extends EventEmitter {
  isTTY: boolean
  isRaw = false
  rawCalls: boolean[] = []
  pauseCalls = 0
  resumeCalls = 0
  refCalls = 0
  unrefCalls = 0
  readCalls = 0
  /** When true, `setRawMode` throws without changing any recorded state. */
  failRawMode = false

  constructor(isTTY = true) {
    super()
    this.isTTY = isTTY
  }

  setRawMode(mode: boolean): this {
    if (this.failRawMode) throw new Error('setRawMode failed')
    this.rawCalls.push(mode)
    this.isRaw = mode
    return this
  }

  pause(): this {
    this.pauseCalls += 1
    return this
  }

  resume(): this {
    this.resumeCalls += 1
    return this
  }

  ref(): this {
    this.refCalls += 1
    return this
  }

  unref(): this {
    this.unrefCalls += 1
    return this
  }

  read(): null {
    this.readCalls += 1
    return null
  }
}

function asSource(source: FakeSource): NodeJS.ReadStream {
  return source as unknown as NodeJS.ReadStream
}

function createMux(
  source: FakeSource,
  options?: SgrInputMultiplexerOptions,
): SgrInputMultiplexer {
  return createSgrInputMultiplexer(asSource(source), options)
}

function collectKeyboard(stdin: NodeJS.ReadStream): {
  bytes(): Buffer
  text(): string
} {
  const chunks: Buffer[] = []
  stdin.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'))
  })
  return {
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString('latin1'),
  }
}

function collectEvents(mux: SgrInputMultiplexer): NormalizedMouseEvent[] {
  const events: NormalizedMouseEvent[] = []
  mux.mouseEvents.subscribe((event) => events.push(event))
  return events
}

/** Minimal stdout for `ink.render` in tests, mirroring existing suites. */
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

describe('createSgrInputMultiplexer', () => {
  it('exposes an Ink-compatible Readable stdin without touching raw mode or process.stdin', () => {
    const processDataBefore = process.stdin.listenerCount('data')
    const processReadableBefore = process.stdin.listenerCount('readable')
    const source = new FakeSource()
    const mux = createMux(source)

    expect(mux.stdin).toBeInstanceOf(Readable)
    expect(mux.stdin).not.toBe(process.stdin)
    expect(mux.stdin.isTTY).toBe(true)
    expect(mux.stdin.isRaw).toBe(false)
    expect(typeof mux.stdin.setRawMode).toBe('function')
    expect(typeof mux.stdin.setEncoding).toBe('function')
    expect(typeof mux.stdin.read).toBe('function')
    expect(typeof mux.stdin.ref).toBe('function')
    expect(typeof mux.stdin.unref).toBe('function')
    expect(typeof mux.mouseEvents.subscribe).toBe('function')
    expect(typeof mux.dispose).toBe('function')

    // Sole consumer of the original source: one flowing 'data' listener, no
    // competing 'readable' reader, no direct `read()`.
    expect(source.listenerCount('data')).toBe(1)
    expect(source.listenerCount('readable')).toBe(0)
    expect(source.readCalls).toBe(0)
    // No setRawMode calls before Ink drives the stream.
    expect(source.rawCalls).toEqual([])
    // The real process.stdin is never touched.
    expect(process.stdin.listenerCount('data')).toBe(processDataBefore)
    expect(process.stdin.listenerCount('readable')).toBe(processReadableBefore)

    mux.dispose()
    expect(source.listenerCount('data')).toBe(0)
    expect(source.listenerCount('end')).toBe(0)
    expect(source.listenerCount('error')).toBe(0)
  })

  it('mirrors a non-TTY source', () => {
    const source = new FakeSource(false)
    const mux = createMux(source)
    expect(mux.stdin.isTTY).toBe(false)
    mux.dispose()
  })

  it('routes keyboard bytes to stdin and normalized mouse events to subscribers in order', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const out = collectKeyboard(mux.stdin)
    const events = collectEvents(mux)

    source.emit('data', Buffer.from('ab'))
    source.emit('data', PRESS_BYTES)
    source.emit('data', Buffer.from('c'))
    await delay()

    expect(out.bytes().equals(Buffer.from('abc'))).toBe(true)
    expect(events).toEqual([left('press', 11, 6)])
    mux.dispose()
  })

  it('preserves keyboard bytes and mouse order for every two-chunk split of a mixed stream', async () => {
    for (let split = 1; split < MIXED.length; split++) {
      const source = new FakeSource()
      const mux = createMux(source)
      const out = collectKeyboard(mux.stdin)
      const events = collectEvents(mux)
      const label = `@${split}`

      source.emit('data', MIXED.subarray(0, split))
      source.emit('data', MIXED.subarray(split))
      await tick()

      expect(out.bytes().equals(MIXED_KEYBOARD), label).toBe(true)
      expect(events, label).toEqual(MIXED_EVENTS)
      mux.dispose()
    }
  })

  it('preserves keyboard bytes and mouse order for every three-chunk split of a mixed stream', async () => {
    const compact = Buffer.concat([
      Buffer.from('k', 'utf8'),
      PRESS_BYTES,
      WHEEL_BYTES,
      Buffer.from('z', 'utf8'),
    ])
    const compactKeyboard = Buffer.from('kz', 'utf8')
    const compactEvents: NormalizedMouseEvent[] = [
      left('press', 11, 6),
      wheel('up', 2, 3),
    ]

    for (let first = 1; first < compact.length - 1; first++) {
      for (let second = first + 1; second < compact.length; second++) {
        const source = new FakeSource()
        const mux = createMux(source)
        const out = collectKeyboard(mux.stdin)
        const events = collectEvents(mux)
        const label = `@${first}/${second}`

        source.emit('data', compact.subarray(0, first))
        source.emit('data', compact.subarray(first, second))
        source.emit('data', compact.subarray(second))
        await tick()

        expect(out.bytes().equals(compactKeyboard), label).toBe(true)
        expect(events, label).toEqual(compactEvents)
        mux.dispose()
      }
    }
  })

  it('consumes unsupported complete reports without leaking them to Ink', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const out = collectKeyboard(mux.stdin)
    const events = collectEvents(mux)

    source.emit(
      'data',
      ascii(`${ESC}[<1;2;3M${ESC}[<32;1;1M${ESC}[<64;1;1m${ESC}[<128;1;1M`),
    )
    await tick()

    expect(out.bytes().length).toBe(0)
    expect(events).toEqual([])
    mux.dispose()
  })

  it('passes malformed and zero-coordinate reports through to Ink byte-exactly', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const out = collectKeyboard(mux.stdin)
    const events = collectEvents(mux)
    const malformed = ascii(`${ESC}[<0;0;5M${ESC}[<123456;1;1M`)

    source.emit('data', malformed)
    await tick()

    expect(out.bytes().equals(malformed)).toBe(true)
    expect(events).toEqual([])
    mux.dispose()
  })

  it('flushes held ESC/partial SGR bytes after the configured timeout', async () => {
    vi.useFakeTimers()
    try {
      const source = new FakeSource()
      const mux = createMux(source, { flushTimeoutMs: 10 })
      const out = collectKeyboard(mux.stdin)
      const events = collectEvents(mux)
      const partial = ascii(`${ESC}[<0;1`)

      source.emit('data', partial)
      expect(out.bytes().length).toBe(0)

      await vi.advanceTimersByTimeAsync(9)
      expect(out.bytes().length).toBe(0)

      await vi.advanceTimersByTimeAsync(2)
      expect(out.bytes().equals(partial)).toBe(true)

      // After the timeout the completing bytes are ordinary keyboard input:
      // no mouse event is synthesized from a timed-out prefix.
      source.emit('data', ascii(';2;3M'))
      expect(out.bytes().equals(Buffer.concat([partial, ascii(';2;3M')]))).toBe(
        true,
      )
      expect(events).toEqual([])
      mux.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defaults to 60ms and clamps larger flush windows to the cap', async () => {
    expect(DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS).toBe(60)
    vi.useFakeTimers()
    try {
      const source = new FakeSource()
      const mux = createMux(source, { flushTimeoutMs: 5000 })
      const out = collectKeyboard(mux.stdin)

      source.emit('data', Buffer.from([0x1b]))
      await vi.advanceTimersByTimeAsync(59)
      expect(out.bytes().length).toBe(0)

      await vi.advanceTimersByTimeAsync(2)
      expect(out.text()).toBe(ESC)
      mux.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses the source on output backpressure and resumes it when stdin drains', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const big = Buffer.alloc(512 * 1024, 0x61)

    // No consumer yet: a chunk past the high-water mark must pause the source.
    source.emit('data', big)
    expect(source.pauseCalls).toBeGreaterThan(0)

    const out = collectKeyboard(mux.stdin)
    await delay(20)
    expect(source.resumeCalls).toBeGreaterThan(0)
    expect(out.bytes().equals(big)).toBe(true)
    mux.dispose()
  })

  it('delegates ref, unref and setRawMode to the source exactly on state changes', () => {
    const source = new FakeSource()
    const mux = createMux(source)

    expect(source.rawCalls).toEqual([])
    mux.stdin.ref()
    mux.stdin.ref()
    expect(source.refCalls).toBe(2)
    mux.stdin.unref()
    expect(source.unrefCalls).toBe(1)

    mux.stdin.setRawMode(true)
    mux.stdin.setRawMode(true)
    expect(source.rawCalls).toEqual([true])
    expect(mux.stdin.isRaw).toBe(true)

    mux.stdin.setRawMode(false)
    mux.stdin.setRawMode(false)
    expect(source.rawCalls).toEqual([true, false])
    expect(mux.stdin.isRaw).toBe(false)
    mux.dispose()
  })

  it('flushes held bytes exactly once when Ink disables raw mode', async () => {
    const source = new FakeSource()
    const mux = createMux(source, { flushTimeoutMs: 5000 })
    const out = collectKeyboard(mux.stdin)
    const partial = ascii(`${ESC}[<0;1`)

    mux.stdin.setRawMode(true)
    source.emit('data', partial)
    expect(out.bytes().length).toBe(0)

    mux.stdin.setRawMode(false)
    await tick()
    expect(out.bytes().equals(partial)).toBe(true)

    // Duplicate disable is filtered: no second flush, no duplication.
    mux.stdin.setRawMode(false)
    await delay(5)
    expect(out.bytes().equals(partial)).toBe(true)
    mux.dispose()
  })

  it('dispose flushes held bytes once, detaches listeners and ends stdin', async () => {
    const source = new FakeSource()
    const mux = createMux(source, { flushTimeoutMs: 5000 })
    const out = collectKeyboard(mux.stdin)
    const ended = new Promise<boolean>((resolve) => {
      mux.stdin.on('end', () => resolve(true))
    })
    const partial = ascii(`${ESC}[<0;1`)

    source.emit('data', partial)
    expect(out.bytes().length).toBe(0)

    mux.dispose()
    mux.dispose()
    await tick()
    expect(out.bytes().equals(partial)).toBe(true)
    expect(source.listenerCount('data')).toBe(0)
    expect(source.listenerCount('end')).toBe(0)
    expect(source.listenerCount('error')).toBe(0)

    // The cleared timer must not produce a second flush.
    await delay(20)
    expect(out.bytes().equals(partial)).toBe(true)
    expect(await ended).toBe(true)

    // No late data after disposal.
    source.emit('data', Buffer.from('late'))
    await delay(5)
    expect(out.bytes().equals(partial)).toBe(true)
  })

  it('flushes held bytes and ends stdin when the source ends', async () => {
    const source = new FakeSource()
    const mux = createMux(source, { flushTimeoutMs: 5000 })
    const out = collectKeyboard(mux.stdin)
    const ended = new Promise<boolean>((resolve) => {
      mux.stdin.on('end', () => resolve(true))
    })

    source.emit('data', ascii(`${ESC}[<0;1`))
    source.emit('end')
    await tick()

    expect(out.text()).toBe(`${ESC}[<0;1`)
    expect(await ended).toBe(true)
    mux.dispose()
  })

  it('absorbs source errors and ends input gracefully', async () => {
    const source = new FakeSource()
    const mux = createMux(source, { flushTimeoutMs: 5000 })
    const out = collectKeyboard(mux.stdin)
    const ended = new Promise<boolean>((resolve) => {
      mux.stdin.on('end', () => resolve(true))
    })

    source.emit('data', ascii(`${ESC}[<0;1`))
    expect(() => source.emit('error', new Error('boom'))).not.toThrow()
    await tick()

    expect(out.text()).toBe(`${ESC}[<0;1`)
    expect(await ended).toBe(true)
    mux.dispose()
  })

  it('keeps split UTF-8 byte-exact and decodes it once at the consumer boundary', async () => {
    const text = 'héllo🚀中'
    const bytes = Buffer.from(text, 'utf8')

    for (const withEncoding of [false, true]) {
      const source = new FakeSource()
      const mux = createMux(source)
      if (withEncoding) mux.stdin.setEncoding('utf8')
      const raw: Buffer[] = []
      const decoded: string[] = []
      mux.stdin.on('data', (chunk: Buffer | string) => {
        if (Buffer.isBuffer(chunk)) raw.push(chunk)
        else decoded.push(chunk)
      })

      for (let index = 0; index < bytes.length; index++) {
        source.emit('data', bytes.subarray(index, index + 1))
      }
      await delay(5)

      if (withEncoding) {
        expect(decoded.join('')).toBe(text)
      } else {
        expect(Buffer.concat(raw).equals(bytes)).toBe(true)
      }
      mux.dispose()
    }
  })

  it('publishes to every subscriber in order and isolates throwing listeners', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const first: NormalizedMouseEvent[] = []
    const second: NormalizedMouseEvent[] = []
    const unsubscribeFirst = mux.mouseEvents.subscribe((event) =>
      first.push(event),
    )
    mux.mouseEvents.subscribe((event) => second.push(event))
    mux.mouseEvents.subscribe(() => {
      throw new Error('consumer boom')
    })
    const out = collectKeyboard(mux.stdin)

    source.emit(
      'data',
      Buffer.concat([PRESS_BYTES, Buffer.from('k'), WHEEL_BYTES]),
    )
    await delay()

    expect(first).toEqual([left('press', 11, 6), wheel('up', 2, 3)])
    expect(second).toEqual(first)
    expect(out.text()).toBe('k')

    unsubscribeFirst()
    source.emit('data', RELEASE_BYTES)
    await delay()
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(3)
    mux.dispose()
  })

  it('drives Ink useInput through the multiplexed stdin with keyboard parity', async () => {
    const source = new FakeSource()
    const mux = createMux(source, { flushTimeoutMs: 5000 })
    const events = collectEvents(mux)
    const inputs: Array<{ input: string; key: Key }> = []

    function Probe() {
      useInput((input, key) => {
        inputs.push({ input, key })
      })
      return createElement(Text, null, 'probe')
    }

    const stdout = new FakeOutput()
    const instance = inkRender(createElement(Probe), {
      stdin: mux.stdin,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      debug: true,
    })
    await delay(30)

    // Ink enabled raw mode through the multiplexed stream.
    expect(source.rawCalls).toEqual([true])
    expect(source.refCalls).toBeGreaterThan(0)

    source.emit('data', Buffer.from('a'))
    await delay()
    expect(inputs.map((entry) => entry.input)).toEqual(['a'])

    source.emit('data', ARROW_BYTES)
    await delay()
    expect(inputs.map((entry) => entry.input)).toEqual(['a', ''])
    expect(inputs.at(-1)?.key.upArrow).toBe(true)

    // Mouse reports are consumed by the multiplexer: Ink never sees them.
    source.emit('data', PRESS_BYTES)
    source.emit('data', RELEASE_BYTES)
    await delay()
    expect(inputs).toHaveLength(2)
    expect(events).toEqual([left('press', 11, 6), left('release', 11, 6)])

    // Interleaved keyboard bytes still reach Ink in order.
    source.emit('data', Buffer.from('x'))
    await delay()
    source.emit('data', Buffer.concat([WHEEL_BYTES, Buffer.from('y')]))
    await delay()
    expect(inputs.map((entry) => entry.input)).toEqual(['a', '', 'x', 'y'])
    expect(events).toHaveLength(3)

    instance.unmount()
    await delay(30)
    expect(source.rawCalls).toEqual([true, false])
    mux.dispose()
  })
})

describe('SgrInputMultiplexer delivery gates and lifecycle', () => {
  it('buffers mouse events until the first subscriber and flushes them exactly once', () => {
    const source = new FakeSource()
    const mux = createMux(source)

    // No subscriber yet: events must not be lost.
    source.emit('data', PRESS_BYTES)
    source.emit('data', WHEEL_BYTES)
    source.emit('data', RELEASE_BYTES)

    const first: NormalizedMouseEvent[] = []
    const unsubscribe = mux.mouseEvents.subscribe((event) => first.push(event))
    expect(first).toEqual([
      left('press', 11, 6),
      wheel('up', 2, 3),
      left('release', 11, 6),
    ])

    // Later events go straight to the live subscriber.
    source.emit('data', PRESS_BYTES)
    expect(first).toHaveLength(4)

    // A later subscriber must not replay the already-flushed buffer.
    unsubscribe()
    const second: NormalizedMouseEvent[] = []
    mux.mouseEvents.subscribe((event) => second.push(event))
    expect(second).toEqual([])
    source.emit('data', RELEASE_BYTES)
    expect(second).toEqual([left('release', 11, 6)])
    mux.dispose()
  })

  it('bounds the pre-subscription buffer by dropping the oldest events', () => {
    const source = new FakeSource()
    const mux = createMux(source)
    for (let index = 0; index < MAX_PENDING_MOUSE_EVENTS + 5; index++) {
      source.emit('data', ascii(`${ESC}[<0;${index + 1};1M`))
    }

    const events: NormalizedMouseEvent[] = []
    mux.mouseEvents.subscribe((event) => events.push(event))
    expect(events).toHaveLength(MAX_PENDING_MOUSE_EVENTS)
    // The five oldest events were dropped; the newest pointer state survives.
    expect(events[0]).toEqual(left('press', 5, 0))
    expect(events.at(-1)).toEqual(
      left('press', MAX_PENDING_MOUSE_EVENTS + 4, 0),
    )
    mux.dispose()
  })

  it('withholds mouse events until the preceding keyboard chunk is consumed', async () => {
    const source = new FakeSource()
    const mux = createMux(source)
    const events = collectEvents(mux)

    source.emit('data', Buffer.concat([Buffer.from('a'), PRESS_BYTES]))
    // The keyboard byte is still unread, so the click waits for it instead of
    // racing the state change it caused.
    expect(events).toEqual([])

    const out = collectKeyboard(mux.stdin)
    await vi.waitFor(
      () => expect(events).toEqual([left('press', 11, 6)]),
      { timeout: 2000, interval: 10 },
    )
    expect(out.text()).toBe('a')
    mux.dispose()
  })

  it('restores source raw mode on dispose even when Ink never unmounts', () => {
    const source = new FakeSource()
    const mux = createMux(source)
    mux.stdin.setRawMode(true)
    expect(source.isRaw).toBe(true)

    mux.dispose()
    expect(source.isRaw).toBe(false)
    expect(source.rawCalls).toEqual([true, false])

    // Idempotent: a second dispose and a late Ink disable must not repeat it.
    mux.dispose()
    mux.stdin.setRawMode(false)
    expect(source.rawCalls).toEqual([true, false])
  })

  it('reports unexpected source termination once and restores raw mode', async () => {
    for (const kind of ['end', 'error'] as const) {
      const source = new FakeSource()
      const errors: unknown[] = []
      let ends = 0
      const mux = createSgrInputMultiplexer(asSource(source), {
        onSourceError: (error) => errors.push(error),
        onSourceEnd: () => {
          ends += 1
        },
      })
      mux.stdin.setRawMode(true)
      const out = collectKeyboard(mux.stdin)
      const ended = new Promise<boolean>((resolve) => {
        mux.stdin.on('end', () => resolve(true))
      })

      source.emit('data', ascii(`${ESC}[<0;1`))
      if (kind === 'error') source.emit('error', new Error('pipe gone'))
      else source.emit('end')
      await tick()

      // Held bytes were flushed and raw mode was restored before the owner
      // callback runs.
      expect(out.text()).toBe(`${ESC}[<0;1`)
      expect(source.isRaw).toBe(false)
      expect(source.rawCalls).toEqual([true, false])
      expect(await ended).toBe(true)
      if (kind === 'error') {
        expect(errors).toHaveLength(1)
        expect((errors[0] as Error).message).toBe('pipe gone')
        expect(ends).toBe(0)
      } else {
        expect(ends).toBe(1)
        expect(errors).toEqual([])
      }

      // Duplicate termination events stay silent.
      if (kind === 'error') source.emit('error', new Error('again'))
      else source.emit('end')
      expect(errors).toHaveLength(kind === 'error' ? 1 : 0)
      expect(ends).toBe(kind === 'error' ? 0 : 1)

      mux.dispose()
      expect(source.rawCalls).toEqual([true, false])
    }
  })

  it('swallows owner callback errors on source termination', () => {
    const source = new FakeSource()
    const mux = createSgrInputMultiplexer(asSource(source), {
      onSourceError: () => {
        throw new Error('owner boom')
      },
    })
    expect(() => source.emit('error', new Error('pipe gone'))).not.toThrow()
    expect(source.isRaw).toBe(false)
    mux.dispose()
  })

  it('keeps raw-mode bookkeeping consistent when the source delegate throws', () => {
    const source = new FakeSource()
    const mux = createMux(source)

    source.failRawMode = true
    expect(() => mux.stdin.setRawMode(true)).toThrow('setRawMode failed')
    // The failed delegate is not recorded as an enabled raw mode.
    expect(mux.stdin.isRaw).toBe(false)
    expect(source.rawCalls).toEqual([])

    // Recovery delegates exactly once and tracks the new state.
    source.failRawMode = false
    mux.stdin.setRawMode(true)
    expect(source.rawCalls).toEqual([true])
    expect(mux.stdin.isRaw).toBe(true)

    // A failing disable is teardown-adjacent: it must not throw, must not
    // claim the source left raw mode, and a later dispose retries it.
    source.failRawMode = true
    expect(() => mux.stdin.setRawMode(false)).not.toThrow()
    expect(mux.stdin.isRaw).toBe(true)
    expect(source.rawCalls).toEqual([true])

    source.failRawMode = false
    mux.dispose()
    expect(source.isRaw).toBe(false)
    expect(source.rawCalls).toEqual([true, false])
  })
})
