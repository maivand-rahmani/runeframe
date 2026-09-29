import { describe, expect, it } from 'vitest'
import type { Key } from 'ink'
import {
  MouseInputParser,
  SGR_MOUSE_MAX_FIELD_DIGITS,
  decodeWheelDirection,
  isPlausibleMousePrefix,
  parseSgrMousePacket,
  type MouseInputRecord,
  type SgrMousePacket,
} from './MouseInputParser.js'

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  } as Key
}

function record(input: string, key: Key = makeKey()): MouseInputRecord {
  return { input, key }
}

const PRESS = '[<0;12;7M'
const RELEASE = '[<0;12;7m'

describe('parseSgrMousePacket', () => {
  it('parses a left press and converts coordinates to zero-based once', () => {
    expect(parseSgrMousePacket(PRESS)).toEqual({
      button: 0,
      x: 11,
      y: 6,
      kind: 'press',
    })
  })

  it('parses a left release', () => {
    expect(parseSgrMousePacket(RELEASE)).toEqual({
      button: 0,
      x: 11,
      y: 6,
      kind: 'release',
    })
  })

  it('keeps modifier bits in the raw button code', () => {
    expect(parseSgrMousePacket('[<20;1;1M')).toEqual({
      button: 20,
      x: 0,
      y: 0,
      kind: 'press',
    })
  })

  it('rejects zero coordinates because SGR coordinates are one-based', () => {
    for (const text of [
      '[<0;0;1M',
      '[<0;0;1m',
      '[<0;1;0M',
      '[<0;0;0m',
      '[<20;0;7M',
      '[<20;7;0M',
    ]) {
      expect(parseSgrMousePacket(text), text).toBeNull()
    }
  })

  it('rejects incomplete, malformed and compound strings', () => {
    for (const text of [
      '',
      '[',
      '[<0;12;7',
      '[<0;12;7X',
      '[<;12;7M',
      '[<0;12M',
      '[<0;12;7;8M',
      '[<a;1;1M',
      'x[<0;1;1M',
      '[<0;12;7MM',
      '[[<0;12;7M',
    ]) {
      expect(parseSgrMousePacket(text), text).toBeNull()
    }
  })
})

describe('decodeWheelDirection', () => {
  function packet(
    button: number,
    kind: SgrMousePacket['kind'] = 'press',
  ): SgrMousePacket {
    return { button, x: 0, y: 0, kind }
  }

  it('decodes bare wheel up/down press reports', () => {
    expect(decodeWheelDirection(packet(64))).toBe('up')
    expect(decodeWheelDirection(packet(65))).toBe('down')
  })

  it('ignores modifier bits on wheel codes', () => {
    // Shift=4, Meta=8, Ctrl=16 (and combinations) decorate the same bases.
    for (const [button, direction] of [
      [68, 'up'],
      [72, 'up'],
      [80, 'up'],
      [84, 'up'],
      [88, 'up'],
      [92, 'up'],
      [69, 'down'],
      [73, 'down'],
      [81, 'down'],
      [85, 'down'],
      [89, 'down'],
      [93, 'down'],
    ] as const) {
      expect(decodeWheelDirection(packet(button)), String(button)).toBe(
        direction,
      )
    }
  })

  it('only routes the press form because wheel has no release', () => {
    expect(decodeWheelDirection(packet(64, 'release'))).toBeNull()
    expect(decodeWheelDirection(packet(65, 'release'))).toBeNull()
    expect(decodeWheelDirection(packet(93, 'release'))).toBeNull()
  })

  it('rejects non-wheel, horizontal-wheel, motion and extended codes', () => {
    for (const button of [
      0,
      1,
      2,
      3,
      20,
      32,
      33,
      34,
      35,
      66, // wheel left
      67, // wheel right
      96, // wheel up + motion bit
      97, // wheel down + motion bit
      128,
      129,
      255,
    ]) {
      expect(decodeWheelDirection(packet(button)), String(button)).toBeNull()
    }
  })

  it('decodes a wheel report assembled from split input records', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record('[')).held).toBe(true)

    const update = parser.push(record('<68;12;7M'))
    expect(update.packet).toEqual({
      button: 68,
      x: 11,
      y: 6,
      kind: 'press',
    })
    expect(decodeWheelDirection(update.packet!)).toBe('up')
  })
})

describe('isPlausibleMousePrefix', () => {
  it('accepts bounded partial prefixes', () => {
    for (const text of ['[', '[<', '[<0', '[<0;', '[<0;1', '[<0;1;', '[<0;1;2']) {
      expect(isPlausibleMousePrefix(text), text).toBe(true)
    }
  })

  it('rejects impossible, malformed and oversized prefixes', () => {
    for (const text of [
      '',
      'a',
      '[a',
      '[<a',
      '[<0;;',
      '[<0;1;2;',
      '[<0;1;2X',
      '[<0;1;2M',
      `[<${'1'.repeat(SGR_MOUSE_MAX_FIELD_DIGITS + 1)}`,
      `[<0;1;2${'3'.repeat(SGR_MOUSE_MAX_FIELD_DIGITS)}`,
    ]) {
      expect(isPlausibleMousePrefix(text), text).toBe(false)
    }
  })
})

describe('MouseInputParser', () => {
  it('consumes a complete packet fed as one record', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record(PRESS))).toEqual({
      replay: [],
      packet: { button: 0, x: 11, y: 6, kind: 'press' },
      held: false,
    })
  })

  it('recognizes every two-chunk split point of press and release', () => {
    for (const packet of [PRESS, RELEASE]) {
      for (let split = 1; split < packet.length; split++) {
        const parser = new MouseInputParser()
        const first = parser.push(record(packet.slice(0, split)))
        expect(first.packet, `${packet} @${split}`).toBeNull()
        expect(first.held, `${packet} @${split}`).toBe(true)
        expect(first.replay, `${packet} @${split}`).toEqual([])

        const second = parser.push(record(packet.slice(split)))
        expect(second.packet, `${packet} @${split}`).not.toBeNull()
        expect(second.packet?.kind, `${packet} @${split}`).toBe(
          packet.endsWith('M') ? 'press' : 'release',
        )
        expect(second.held, `${packet} @${split}`).toBe(false)
        expect(second.replay, `${packet} @${split}`).toEqual([])
      }
    }
  })

  it('assembles a packet spread over more than two records', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record('[')).held).toBe(true)
    expect(parser.push(record('<0;')).held).toBe(true)
    expect(parser.push(record('12;7')).held).toBe(true)
    const complete = parser.push(record('M'))
    expect(complete.packet).toEqual({
      button: 0,
      x: 11,
      y: 6,
      kind: 'press',
    })
    expect(complete.held).toBe(false)
  })

  it('replays abandoned prefixes as the original records, in order', () => {
    const parser = new MouseInputParser()
    const firstKey = makeKey({ shift: true })
    const first = record('[', firstKey)
    const secondKey = makeKey({ meta: true })
    const second = record('<', secondKey)

    expect(parser.push(first).held).toBe(true)
    expect(parser.push(second).held).toBe(true)

    const update = parser.push(record('q'))
    expect(update.replay).toHaveLength(2)
    // Exact record identity: no synthesized input, no lost metadata.
    expect(update.replay[0]).toBe(first)
    expect(update.replay[1]).toBe(second)
    expect(update.replay[0].key).toBe(firstKey)
    expect(update.replay[1].key).toBe(secondKey)
    expect(update.packet).toBeNull()
    expect(update.held).toBe(false)
    expect(parser.hasPending()).toBe(false)
  })

  it('replays a zero-coordinate report instead of consuming it', () => {
    const parser = new MouseInputParser()
    const malformedKey = makeKey({ ctrl: true, shift: true })
    const malformed = record('[<0;0;5M', malformedKey)

    // Not a packet and not a plausible prefix: the caller must dispatch this
    // original record through the keyboard path, metadata intact.
    expect(parser.push(malformed)).toEqual({
      replay: [],
      packet: null,
      held: false,
    })
    expect(parser.hasPending()).toBe(false)
  })

  it('replays a held prefix unchanged when a zero coordinate completes it', () => {
    const parser = new MouseInputParser()
    const first = record('[<0;0', makeKey({ shift: true }))
    const second = record(';5', makeKey({ meta: true }))
    expect(parser.push(first).held).toBe(true)
    expect(parser.push(second).held).toBe(true)

    const update = parser.push(record('M'))
    expect(update.replay).toHaveLength(2)
    // Exact record identity and metadata: no synthesized input, no dropped keys.
    expect(update.replay[0]).toBe(first)
    expect(update.replay[1]).toBe(second)
    expect(update.replay[0].key).toBe(first.key)
    expect(update.replay[1].key).toBe(second.key)
    expect(update.packet).toBeNull()
    expect(update.held).toBe(false)
    expect(parser.hasPending()).toBe(false)
  })

  it('passes non-mouse input through untouched', () => {
    const parser = new MouseInputParser()
    for (const input of ['a', 'enter-missing', '[a', '[<0;12;7X', '[<0;1;2;3M']) {
      expect(parser.push(record(input))).toEqual({
        replay: [],
        packet: null,
        held: false,
      })
    }
  })

  it('replays a held prefix when the field grows over its bound', () => {
    const parser = new MouseInputParser()
    const prefix = record('[<12')
    expect(parser.push(prefix).held).toBe(true)

    const update = parser.push(record('345678'))
    expect(update.replay).toEqual([prefix])
    expect(update.replay[0]).toBe(prefix)
    expect(update.packet).toBeNull()
    expect(update.held).toBe(false)
  })

  it('starts a new prefix from the current record after replaying an old one', () => {
    const parser = new MouseInputParser()
    const stray = record('[<9')
    expect(parser.push(stray).held).toBe(true)

    const update = parser.push(record('['))
    expect(update.replay).toEqual([stray])
    expect(update.held).toBe(true)
    expect(parser.hasPending()).toBe(true)
  })

  it('replays a stray prefix and still consumes a complete packet', () => {
    const parser = new MouseInputParser()
    const stray = record('[')
    expect(parser.push(stray).held).toBe(true)

    const update = parser.push(record(PRESS))
    expect(update.replay).toEqual([stray])
    expect(update.packet).toEqual({
      button: 0,
      x: 11,
      y: 6,
      kind: 'press',
    })
    expect(update.held).toBe(false)
  })

  it('flushes pending records on timeout, preserving identity and order', () => {
    const parser = new MouseInputParser()
    const first = record('[<0;1')
    const second = record('2;')
    expect(parser.push(first).held).toBe(true)
    expect(parser.push(second).held).toBe(true)
    expect(parser.hasPending()).toBe(true)

    const flushed = parser.flush()
    expect(flushed).toHaveLength(2)
    expect(flushed[0]).toBe(first)
    expect(flushed[1]).toBe(second)
    expect(parser.hasPending()).toBe(false)
    expect(parser.flush()).toEqual([])
  })

  it('keeps keyboard and mouse events interleaved in order', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record('a'))).toEqual({
      replay: [],
      packet: null,
      held: false,
    })
    expect(parser.push(record('[')).held).toBe(true)
    const interleaved = parser.push(record('b'))
    expect(interleaved.replay.map((entry) => entry.input)).toEqual(['['])
    expect(interleaved.packet).toBeNull()
    expect(interleaved.held).toBe(false)
  })

  it('parses consecutive press and release reports independently', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record(PRESS)).packet?.kind).toBe('press')
    expect(parser.push(record(RELEASE)).packet?.kind).toBe('release')
  })

  it('reset drops any buffered prefix', () => {
    const parser = new MouseInputParser()
    expect(parser.push(record('[<')).held).toBe(true)
    parser.reset()
    expect(parser.hasPending()).toBe(false)
    expect(parser.flush()).toEqual([])
  })
})
