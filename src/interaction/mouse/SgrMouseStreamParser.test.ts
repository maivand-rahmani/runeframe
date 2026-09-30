import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  SgrMouseStreamParser,
  SGR_MOUSE_MAX_CANDIDATE_BYTES,
  type NormalizedMouseEvent,
  type SgrMouseStreamOutput,
} from './SgrMouseStreamParser.js'

const ESC = '\u001b'

/** Encode an ASCII/control input string byte-for-byte. */
function ascii(text: string): Buffer {
  return Buffer.from(text, 'latin1')
}

function keyboardBytes(output: SgrMouseStreamOutput[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of output) {
    if (entry.type === 'keyboard') chunks.push(entry.data)
  }
  return Buffer.concat(chunks)
}

function mouseEvents(output: SgrMouseStreamOutput[]): NormalizedMouseEvent[] {
  const events: NormalizedMouseEvent[] = []
  for (const entry of output) {
    if (entry.type === 'mouse') events.push(entry.event)
  }
  return events
}

const PRESS = `${ESC}[<0;12;7M`
const RELEASE = `${ESC}[<0;12;7m`
const WHEEL_UP = `${ESC}[<64;3;4M`
const WHEEL_DOWN = `${ESC}[<65;9;2M`

const LEFT_PRESS: NormalizedMouseEvent = {
  type: 'press',
  button: 'left',
  x: 11,
  y: 6,
  shift: false,
  alt: false,
  ctrl: false,
}
const LEFT_RELEASE: NormalizedMouseEvent = {
  type: 'release',
  button: 'left',
  x: 11,
  y: 6,
  shift: false,
  alt: false,
  ctrl: false,
}
const WHEEL_UP_EVENT: NormalizedMouseEvent = {
  type: 'wheel',
  direction: 'up',
  x: 2,
  y: 3,
  shift: false,
  alt: false,
  ctrl: false,
}
const WHEEL_DOWN_EVENT: NormalizedMouseEvent = {
  type: 'wheel',
  direction: 'down',
  x: 8,
  y: 1,
  shift: false,
  alt: false,
  ctrl: false,
}

const SUPPORTED: ReadonlyArray<readonly [string, NormalizedMouseEvent]> = [
  [PRESS, LEFT_PRESS],
  [RELEASE, LEFT_RELEASE],
  [WHEEL_UP, WHEEL_UP_EVENT],
  [WHEEL_DOWN, WHEEL_DOWN_EVENT],
]

const UNSUPPORTED = [
  `${ESC}[<1;2;3M`, // middle press
  `${ESC}[<2;2;3M`, // right press
  `${ESC}[<3;2;3m`, // release without a button
  `${ESC}[<32;2;3M`, // motion without a button
  `${ESC}[<33;2;3M`, // motion + left
  `${ESC}[<64;2;3m`, // wheel up in release form
  `${ESC}[<65;2;3m`, // wheel down in release form
  `${ESC}[<66;2;3M`, // wheel left
  `${ESC}[<67;2;3M`, // wheel right
  `${ESC}[<96;2;3M`, // wheel up + motion
  `${ESC}[<97;2;3M`, // wheel down + motion
  `${ESC}[<128;2;3M`, // extra button bit
]

const MIXED_KEYBOARD = Buffer.concat([
  ascii(`${ESC}[A`),
  Buffer.from('héllo 🚀', 'utf8'),
  ascii(`${ESC}[1;5C`),
  Buffer.from('q', 'utf8'),
])
const MIXED_STREAM = Buffer.concat([
  ascii(`${ESC}[A`),
  Buffer.from('héllo 🚀', 'utf8'),
  ascii(`${ESC}[1;5C`),
  ascii(PRESS),
  Buffer.from('q', 'utf8'),
  ascii(WHEEL_DOWN),
  ascii(RELEASE),
])
const MIXED_EVENTS = [LEFT_PRESS, WHEEL_DOWN_EVENT, LEFT_RELEASE]

describe('SgrMouseStreamParser', () => {
  it('recognizes each supported report fed as one chunk', () => {
    for (const [packet, event] of SUPPORTED) {
      const parser = new SgrMouseStreamParser()
      expect(parser.push(ascii(packet)), packet).toEqual([
        { type: 'mouse', event },
      ])
      expect(parser.hasPending(), packet).toBe(false)
    }
  })

  it('recognizes every two-chunk split of press, release and wheel', () => {
    for (const [packet, event] of SUPPORTED) {
      const raw = ascii(packet)
      for (let split = 1; split < raw.length; split++) {
        const label = `${packet} @${split}`
        const parser = new SgrMouseStreamParser()
        expect(parser.push(raw.subarray(0, split)), label).toEqual([])
        expect(parser.hasPending(), label).toBe(true)
        expect(parser.push(raw.subarray(split)), label).toEqual([
          { type: 'mouse', event },
        ])
        expect(parser.hasPending(), label).toBe(false)
      }
    }
  })

  it('recognizes every three-chunk split of press, release and wheel', () => {
    for (const [packet, event] of SUPPORTED) {
      const raw = ascii(packet)
      for (let first = 1; first < raw.length - 1; first++) {
        for (let second = first + 1; second < raw.length; second++) {
          const label = `${packet} @${first}/${second}`
          const parser = new SgrMouseStreamParser()
          expect(parser.push(raw.subarray(0, first)), label).toEqual([])
          expect(parser.push(raw.subarray(first, second)), label).toEqual([])
          expect(parser.push(raw.subarray(second)), label).toEqual([
            { type: 'mouse', event },
          ])
          expect(parser.hasPending(), label).toBe(false)
        }
      }
    }
  })

  it('decodes left press and release with modifier flags', () => {
    const cases: ReadonlyArray<readonly [string, NormalizedMouseEvent]> = [
      [
        `${ESC}[<4;1;1M`,
        {
          type: 'press',
          button: 'left',
          x: 0,
          y: 0,
          shift: true,
          alt: false,
          ctrl: false,
        },
      ],
      [
        `${ESC}[<8;2;3M`,
        {
          type: 'press',
          button: 'left',
          x: 1,
          y: 2,
          shift: false,
          alt: true,
          ctrl: false,
        },
      ],
      [
        `${ESC}[<16;3;4m`,
        {
          type: 'release',
          button: 'left',
          x: 2,
          y: 3,
          shift: false,
          alt: false,
          ctrl: true,
        },
      ],
      [
        `${ESC}[<20;5;6M`,
        {
          type: 'press',
          button: 'left',
          x: 4,
          y: 5,
          shift: true,
          alt: false,
          ctrl: true,
        },
      ],
      [
        `${ESC}[<28;7;8m`,
        {
          type: 'release',
          button: 'left',
          x: 6,
          y: 7,
          shift: true,
          alt: true,
          ctrl: true,
        },
      ],
    ]
    for (const [packet, event] of cases) {
      expect(new SgrMouseStreamParser().push(ascii(packet)), packet).toEqual([
        { type: 'mouse', event },
      ])
    }
  })

  it('decodes wheel reports with modifier flags', () => {
    const cases: ReadonlyArray<readonly [string, NormalizedMouseEvent]> = [
      [
        `${ESC}[<68;1;2M`,
        {
          type: 'wheel',
          direction: 'up',
          x: 0,
          y: 1,
          shift: true,
          alt: false,
          ctrl: false,
        },
      ],
      [
        `${ESC}[<72;3;4M`,
        {
          type: 'wheel',
          direction: 'up',
          x: 2,
          y: 3,
          shift: false,
          alt: true,
          ctrl: false,
        },
      ],
      [
        `${ESC}[<80;5;6M`,
        {
          type: 'wheel',
          direction: 'up',
          x: 4,
          y: 5,
          shift: false,
          alt: false,
          ctrl: true,
        },
      ],
      [
        `${ESC}[<92;7;8M`,
        {
          type: 'wheel',
          direction: 'up',
          x: 6,
          y: 7,
          shift: true,
          alt: true,
          ctrl: true,
        },
      ],
      [
        `${ESC}[<93;9;10M`,
        {
          type: 'wheel',
          direction: 'down',
          x: 8,
          y: 9,
          shift: true,
          alt: true,
          ctrl: true,
        },
      ],
    ]
    for (const [packet, event] of cases) {
      expect(new SgrMouseStreamParser().push(ascii(packet)), packet).toEqual([
        { type: 'mouse', event },
      ])
    }
  })

  it('consumes unsupported complete reports silently at every split', () => {
    for (const packet of UNSUPPORTED) {
      const raw = ascii(packet)
      for (let split = 1; split < raw.length; split++) {
        const label = `${packet} @${split}`
        const parser = new SgrMouseStreamParser()
        expect(parser.push(raw.subarray(0, split)), label).toEqual([])
        expect(parser.push(raw.subarray(split)), label).toEqual([])
        expect(parser.hasPending(), label).toBe(false)
      }
      const parser = new SgrMouseStreamParser()
      expect(parser.push(raw), packet).toEqual([])
      expect(parser.hasPending(), packet).toBe(false)
    }
  })

  it('never leaks an unsupported report as text in a mixed stream', () => {
    const parser = new SgrMouseStreamParser()
    const stream = Buffer.concat([
      ascii('a'),
      ascii(`${ESC}[<1;2;3M`),
      ascii('b'),
      ascii(PRESS),
    ])
    expect(parser.push(stream)).toEqual([
      { type: 'keyboard', data: ascii('ab') },
      { type: 'mouse', event: LEFT_PRESS },
    ])
    expect(parser.hasPending()).toBe(false)
  })

  it('replays malformed, zero and oversized reports byte-for-byte', () => {
    const malformed = [
      `${ESC}[<0;0;5M`, // zero column
      `${ESC}[<0;5;0m`, // zero row
      `${ESC}[<0;0;0M`, // both zero
      `${ESC}[<1;2;3;4M`, // too many parameters
      `${ESC}[<123456;1;1M`, // six-digit button
      `${ESC}[<0;123456;1M`, // six-digit column
      `${ESC}[<0;1;123456M`, // six-digit row
      `${ESC}[<;1;1M`, // empty button
      `${ESC}[<0;;1M`, // empty column
      `${ESC}[<M`, // no parameters at all
      `${ESC}[<0;1;1X`, // unknown final byte
      `${ESC}[<${'1'.repeat(40)}M`, // digit run far past the field cap
      `${ESC}[<${'1;'.repeat(20)}1M`, // far too many parameters
    ]
    for (const packet of malformed) {
      const parser = new SgrMouseStreamParser()
      const raw = ascii(packet)
      const output = parser.push(raw)
      expect(mouseEvents(output), packet).toEqual([])
      expect(keyboardBytes(output).equals(raw), packet).toBe(true)
      expect(parser.hasPending(), packet).toBe(false)
      expect(parser.flush().length, packet).toBe(0)
    }
  })

  it('replays a zero-coordinate report split at every boundary', () => {
    const raw = ascii(`${ESC}[<0;0;5M`)
    for (let split = 1; split < raw.length; split++) {
      const label = `@${split}`
      const parser = new SgrMouseStreamParser()
      const output = [
        ...parser.push(raw.subarray(0, split)),
        ...parser.push(raw.subarray(split)),
      ]
      expect(mouseEvents(output), label).toEqual([])
      expect(keyboardBytes(output).equals(raw), label).toBe(true)
      expect(parser.hasPending(), label).toBe(false)
    }
  })

  it('restarts a packet after replaying an invalid candidate', () => {
    const expectedEvent: NormalizedMouseEvent = {
      type: 'press',
      button: 'left',
      x: 1,
      y: 1,
      shift: false,
      alt: false,
      ctrl: false,
    }
    const stray = ascii(`${ESC}[<0;1;1`)
    const packet = ascii(`${ESC}[<0;2;2M`)

    const single = new SgrMouseStreamParser()
    expect(single.push(Buffer.concat([stray, packet]))).toEqual([
      { type: 'keyboard', data: stray },
      { type: 'mouse', event: expectedEvent },
    ])

    const split = new SgrMouseStreamParser()
    expect(split.push(stray)).toEqual([])
    expect(split.hasPending()).toBe(true)
    expect(split.push(packet)).toEqual([
      { type: 'keyboard', data: stray },
      { type: 'mouse', event: expectedEvent },
    ])
    expect(split.hasPending()).toBe(false)
  })

  it('holds incomplete candidates until flush and replays them exactly once', () => {
    const parser = new SgrMouseStreamParser()
    const held = ascii(`${ESC}[<0;1`)
    expect(parser.push(held)).toEqual([])
    expect(parser.hasPending()).toBe(true)

    const flushed = parser.flush()
    expect(flushed.equals(held)).toBe(true)
    expect(parser.hasPending()).toBe(false)
    expect(parser.flush().length).toBe(0)

    // After a timeout the following bytes are new input, never duplicated.
    const output = parser.push(ascii(';2;3M'))
    expect(mouseEvents(output)).toEqual([])
    expect(keyboardBytes(output).equals(ascii(';2;3M'))).toBe(true)
  })

  it('flush releases a lone ESC and preserves held order', () => {
    const parser = new SgrMouseStreamParser()
    expect(parser.push(Buffer.from([0x1b]))).toEqual([])
    expect(parser.push(ascii('['))).toEqual([])
    expect(parser.push(ascii('<0;1'))).toEqual([])
    expect(parser.hasPending()).toBe(true)
    expect(parser.flush().equals(ascii(`${ESC}[<0;1`))).toBe(true)
    expect(parser.hasPending()).toBe(false)
  })

  it('flush after a completed packet returns no bytes', () => {
    const parser = new SgrMouseStreamParser()
    expect(parser.push(ascii(PRESS))).toEqual([
      { type: 'mouse', event: LEFT_PRESS },
    ])
    expect(parser.flush().length).toBe(0)
  })

  it('reset drops pending bytes', () => {
    const parser = new SgrMouseStreamParser()
    expect(parser.push(ascii(`${ESC}[<0;1;1`))).toEqual([])
    parser.reset()
    expect(parser.hasPending()).toBe(false)
    expect(parser.flush().length).toBe(0)
    expect(parser.push(ascii(PRESS))).toEqual([
      { type: 'mouse', event: LEFT_PRESS },
    ])
  })

  it('ignores empty chunks', () => {
    const parser = new SgrMouseStreamParser()
    expect(parser.push(Buffer.alloc(0))).toEqual([])
    expect(parser.push(Buffer.alloc(0))).toEqual([])
    expect(parser.hasPending()).toBe(false)
  })

  it('passes keyboard CSI, escape and UTF-8 bytes through exactly at every split', () => {
    const inputs = [
      ascii(`${ESC}[A`),
      ascii(`${ESC}[1;5C`),
      ascii(`${ESC}[200~`),
      Buffer.from('héllo 🚀 中文', 'utf8'),
      // Ends in a plausible candidate: those bytes are held until flush.
      Buffer.concat([
        Buffer.from('ab', 'utf8'),
        ascii(`${ESC}[A`),
        Buffer.from('中', 'utf8'),
        ascii(`${ESC}[<`),
      ]),
    ]
    for (const raw of inputs) {
      const single = new SgrMouseStreamParser()
      const singleOutput = single.push(raw)
      expect(mouseEvents(singleOutput)).toEqual([])
      expect(
        Buffer.concat([keyboardBytes(singleOutput), single.flush()]).equals(
          raw,
        ),
      ).toBe(true)

      for (let split = 1; split < raw.length; split++) {
        const label = `@${split}`
        const parser = new SgrMouseStreamParser()
        const output = [
          ...parser.push(raw.subarray(0, split)),
          ...parser.push(raw.subarray(split)),
        ]
        expect(mouseEvents(output), label).toEqual([])
        expect(
          Buffer.concat([keyboardBytes(output), parser.flush()]).equals(raw),
          label,
        ).toBe(true)
      }
    }
  })

  it('preserves order and count of a mixed stream at every two-way split', () => {
    for (let split = 1; split < MIXED_STREAM.length; split++) {
      const label = `@${split}`
      const parser = new SgrMouseStreamParser()
      const output = [
        ...parser.push(MIXED_STREAM.subarray(0, split)),
        ...parser.push(MIXED_STREAM.subarray(split)),
      ]
      expect(
        Buffer.concat([keyboardBytes(output), parser.flush()]).equals(
          MIXED_KEYBOARD,
        ),
        label,
      ).toBe(true)
      expect(mouseEvents(output), label).toEqual(MIXED_EVENTS)
      expect(parser.hasPending(), label).toBe(false)
    }
  })

  it('preserves order and count of a mixed stream for random chunkings', () => {
    for (let seed = 1; seed <= 64; seed++) {
      const label = `seed ${seed}`
      const parser = new SgrMouseStreamParser()
      const output: SgrMouseStreamOutput[] = []
      let offset = 0
      let state = seed >>> 0
      while (offset < MIXED_STREAM.length) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const end = Math.min(offset + 1 + (state % 9), MIXED_STREAM.length)
        output.push(...parser.push(MIXED_STREAM.subarray(offset, end)))
        offset = end
      }
      expect(
        Buffer.concat([keyboardBytes(output), parser.flush()]).equals(
          MIXED_KEYBOARD,
        ),
        label,
      ).toBe(true)
      expect(mouseEvents(output), label).toEqual(MIXED_EVENTS)
    }
  })

  it('keeps consecutive reports in order without merging', () => {
    const parser = new SgrMouseStreamParser()
    const output = parser.push(ascii(PRESS + RELEASE + WHEEL_UP))
    expect(mouseEvents(output)).toEqual([
      LEFT_PRESS,
      LEFT_RELEASE,
      WHEEL_UP_EVENT,
    ])
    expect(keyboardBytes(output).length).toBe(0)
    expect(parser.hasPending()).toBe(false)
  })

  it('accepts boundary coordinates and replays six-digit coordinates', () => {
    const parser = new SgrMouseStreamParser()
    expect(parser.push(ascii(`${ESC}[<0;1;1M`))).toEqual([
      {
        type: 'mouse',
        event: {
          type: 'press',
          button: 'left',
          x: 0,
          y: 0,
          shift: false,
          alt: false,
          ctrl: false,
        },
      },
    ])
    expect(parser.push(ascii(`${ESC}[<0;99999;99999M`))).toEqual([
      {
        type: 'mouse',
        event: {
          type: 'press',
          button: 'left',
          x: 99998,
          y: 99998,
          shift: false,
          alt: false,
          ctrl: false,
        },
      },
    ])
    const oversize = ascii(`${ESC}[<0;100000;1M`)
    const output = parser.push(oversize)
    expect(mouseEvents(output)).toEqual([])
    expect(keyboardBytes(output).equals(oversize)).toBe(true)
  })

  it('bounds candidates to five digits per field and 32 bytes overall', () => {
    expect(SGR_MOUSE_MAX_CANDIDATE_BYTES).toBe(32)
    const parser = new SgrMouseStreamParser()
    const junk = ascii(`${ESC}[<${'9'.repeat(500)}`)
    const output = parser.push(junk)
    expect(mouseEvents(output)).toEqual([])
    expect(keyboardBytes(output).equals(junk)).toBe(true)
    expect(parser.hasPending()).toBe(false)
    expect(parser.flush().length).toBe(0)
  })
})
