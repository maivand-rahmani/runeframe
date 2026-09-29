import { describe, it, expect } from 'vitest'
import type { Key } from 'ink'
import { normalizeKey } from './KeyEventNormalizer.js'

function mockKey(overrides: Partial<Key> = {}): Key {
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
  }
}

describe('normalizeKey', () => {
  it('normalizes printable character "a" with no modifiers', () => {
    const result = normalizeKey('a', mockKey())
    expect(result).toEqual({
      key: 'a',
      text: 'a',
      isPrintable: true,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      code: 'a',
      backspace: false,
      enter: false,
      escape: false,
      tab: false,
      space: false,
      up: false,
      down: false,
      left: false,
      right: false,
      rawInput: 'a',
    })
  })

  it('normalizes uppercase "B" with shift=true → key is lowercase, text is uppercase', () => {
    const result = normalizeKey('B', mockKey({ shift: true }))
    expect(result.key).toBe('b')
    expect(result.text).toBe('B')
    expect(result.isPrintable).toBe(true)
    expect(result.shift).toBe(true)
  })

  it('normalizes Enter key', () => {
    const result = normalizeKey('', mockKey({ return: true }))
    expect(result.key).toBe('enter')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
    expect(result.enter).toBe(true)
    expect(result.code).toBe('enter')
  })

  it('normalizes Escape key', () => {
    const result = normalizeKey('', mockKey({ escape: true }))
    expect(result.key).toBe('escape')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
    expect(result.escape).toBe(true)
  })

  it('normalizes Up arrow', () => {
    const result = normalizeKey('', mockKey({ upArrow: true }))
    expect(result.key).toBe('up')
    expect(result.up).toBe(true)
  })

  it('normalizes Down arrow', () => {
    const result = normalizeKey('', mockKey({ downArrow: true }))
    expect(result.key).toBe('down')
    expect(result.down).toBe(true)
  })

  it('normalizes Left arrow', () => {
    const result = normalizeKey('', mockKey({ leftArrow: true }))
    expect(result.key).toBe('left')
    expect(result.left).toBe(true)
  })

  it('normalizes Right arrow', () => {
    const result = normalizeKey('', mockKey({ rightArrow: true }))
    expect(result.key).toBe('right')
    expect(result.right).toBe(true)
  })

  it('normalizes Backspace', () => {
    const result = normalizeKey('', mockKey({ backspace: true }))
    expect(result.key).toBe('backspace')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
    expect(result.backspace).toBe(true)
  })

  it('normalizes Delete', () => {
    const result = normalizeKey('', mockKey({ delete: true }))
    expect(result.key).toBe('delete')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
  })

  it('normalizes Tab', () => {
    const result = normalizeKey('', mockKey({ tab: true }))
    expect(result.key).toBe('tab')
    expect(result.tab).toBe(true)
  })

  it('normalizes Space', () => {
    const result = normalizeKey(' ', mockKey())
    expect(result.key).toBe('space')
    expect(result.text).toBe(' ')
    expect(result.isPrintable).toBe(true)
    expect(result.space).toBe(true)
  })

  it('Ctrl+C suppresses isPrintable and sets ctrl flag', () => {
    const result = normalizeKey('c', mockKey({ ctrl: true }))
    expect(result.key).toBe('c')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
    expect(result.ctrl).toBe(true)
  })

  it('non-printable Unicode character returns isPrintable false', () => {
    // ← is a single Unicode char but not ASCII printable (it's U+2190)
    const result = normalizeKey('\u2190', mockKey())
    expect(result.key).toBe('\u2190')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
  })

  it('empty string input falls through to raw input mapping', () => {
    // With no special key flags, empty input maps key to empty string
    const result = normalizeKey('', mockKey())
    expect(result.key).toBe('')
    expect(result.text).toBe('')
    expect(result.isPrintable).toBe(false)
    expect(result.code).toBe('')
  })

  it('Arrow key wins over printable input', () => {
    // If both upArrow and a printable char are present, arrow wins in priority
    const result = normalizeKey('a', mockKey({ upArrow: true }))
    expect(result.key).toBe('up')
    expect(result.up).toBe(true)
  })

  it('Enter wins over escape when both flags are set (priority order)', () => {
    const result = normalizeKey('', mockKey({ return: true, escape: true }))
    expect(result.key).toBe('enter')
    expect(result.enter).toBe(true)
    expect(result.escape).toBe(true)
  })

  it('sets meta flag from key.meta', () => {
    const result = normalizeKey('x', mockKey({ meta: true }))
    expect(result.meta).toBe(true)
    // meta suppresses isPrintable
    expect(result.isPrintable).toBe(false)
  })

  it('sets code field equal to key', () => {
    const result = normalizeKey('a', mockKey())
    expect(result.code).toBe(result.key)
    expect(result.code).toBe('a')
  })

  it('preserves rawInput', () => {
    const result = normalizeKey('hello', mockKey())
    expect(result.rawInput).toBe('hello')
  })
})
