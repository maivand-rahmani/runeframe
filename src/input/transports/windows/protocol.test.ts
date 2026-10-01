import { describe, expect, it } from 'vitest'
import {
  MAX_HELPER_LINE_CHARS,
  parseHelperEvent,
  splitHelperLines,
} from './protocol.js'

describe('parseHelperEvent', () => {
  it('parses a ready record', () => {
    expect(
      parseHelperEvent('{"type":"ready","originalMode":496,"mode":144}'),
    ).toEqual({ type: 'ready', originalMode: 496, mode: 144 })
  })

  it('parses a key record with the native boolean down field', () => {
    expect(
      parseHelperEvent(
        '{"type":"key","down":true,"repeat":2,"char":"a","virtualKey":65,"virtualScanCode":30,"control":8}',
      ),
    ).toEqual({
      type: 'key',
      down: true,
      repeat: 2,
      char: 'a',
      virtualKey: 65,
      virtualScanCode: 30,
      control: 8,
    })
  })

  it('never coerces a numeric down field: the wire contract is a JSON boolean', () => {
    expect(
      parseHelperEvent('{"type":"key","down":1,"char":"a"}'),
    ).toBeNull()
    expect(
      parseHelperEvent('{"type":"key","down":0,"char":"a"}'),
    ).toBeNull()
  })

  it('applies optional key defaults and keeps a missing scan code null', () => {
    expect(parseHelperEvent('{"type":"key","down":true,"char":"x"}')).toEqual({
      type: 'key',
      down: true,
      repeat: 1,
      char: 'x',
      virtualKey: 0,
      virtualScanCode: null,
      control: 0,
    })
    expect(
      parseHelperEvent(
        '{"type":"key","down":true,"char":"x","virtualScanCode":-1}',
      )?.type,
    ).toBe('key')
    expect(
      parseHelperEvent(
        '{"type":"key","down":true,"char":"x","virtualScanCode":-1}',
      ),
    ).toMatchObject({ virtualScanCode: null })
    expect(
      parseHelperEvent(
        '{"type":"key","down":true,"char":"x","virtualScanCode":"30"}',
      ),
    ).toMatchObject({ virtualScanCode: null })
  })

  it('parses a mouse record and defaults the viewport origin', () => {
    expect(
      parseHelperEvent(
        '{"type":"mouse","x":4,"y":2,"buttons":1,"flags":0,"control":0,"windowLeft":2,"windowTop":1}',
      ),
    ).toEqual({
      type: 'mouse',
      x: 4,
      y: 2,
      buttons: 1,
      flags: 0,
      control: 0,
      windowLeft: 2,
      windowTop: 1,
    })
    expect(
      parseHelperEvent('{"type":"mouse","x":1,"y":1,"buttons":0,"flags":0}'),
    ).toMatchObject({ windowLeft: 0, windowTop: 0, control: 0 })
  })

  it('parses resize and error records', () => {
    expect(
      parseHelperEvent('{"type":"resize","columns":80,"rows":30}'),
    ).toEqual({ type: 'resize', columns: 80, rows: 30 })
    expect(
      parseHelperEvent('{"type":"error","message":"console handle lost"}'),
    ).toEqual({ type: 'error', message: 'console handle lost' })
  })

  it('rejects malformed JSON, unknown types and records with missing fields', () => {
    for (const line of [
      '',
      'not json',
      '[]',
      'null',
      '"ready"',
      '{"type":"unknown"}',
      '{"type":"ready","originalMode":1}',
      '{"type":"ready","mode":1}',
      '{"type":"key","char":"a"}',
      '{"type":"key","down":true}',
      '{"type":"mouse","x":1,"y":1,"buttons":1}',
      '{"type":"mouse","x":1,"y":1,"flags":0}',
      '{"type":"resize","columns":80}',
      '{"type":"error"}',
    ]) {
      expect(parseHelperEvent(line), line).toBeNull()
    }
  })

  it('rejects non-finite numeric fields', () => {
    // JSON cannot carry NaN/Infinity, but a numeric string must not pass.
    expect(
      parseHelperEvent('{"type":"mouse","x":"1","y":1,"buttons":1,"flags":0}'),
    ).toBeNull()
    expect(
      parseHelperEvent('{"type":"resize","columns":null,"rows":30}'),
    ).toBeNull()
  })
})

describe('splitHelperLines', () => {
  it('returns complete lines and keeps the partial remainder', () => {
    const first = splitHelperLines('', '{"a":1}\n{"b"')
    expect(first.lines).toEqual(['{"a":1}'])
    expect(first.rest).toBe('{"b"')

    const second = splitHelperLines(first.rest, ':2}\n')
    expect(second.lines).toEqual(['{"b":2}'])
    expect(second.rest).toBe('')
  })

  it('handles multiple lines in one chunk and trims CRLF line endings', () => {
    const split = splitHelperLines('', 'one\r\ntwo\n\nthree\npartial')
    expect(split.lines).toEqual(['one', 'two', 'three'])
    expect(split.rest).toBe('partial')
  })

  it('skips empty and whitespace-only lines', () => {
    const split = splitHelperLines('', '\n   \n{"type":"ready","originalMode":1,"mode":1}\n')
    expect(split.lines).toEqual(['{"type":"ready","originalMode":1,"mode":1}'])
  })

  it('keeps a rest longer than the line cap so the caller can reject it', () => {
    const split = splitHelperLines('', 'x'.repeat(MAX_HELPER_LINE_CHARS + 1))
    expect(split.lines).toEqual([])
    expect(split.rest.length).toBe(MAX_HELPER_LINE_CHARS + 1)
  })
})
