import type { Key } from 'ink'
import type { NormalizedKeyEvent } from '../../types.js'

export const KEY_ENTER = 'enter'
export const KEY_ESCAPE = 'escape'
export const KEY_TAB = 'tab'
export const KEY_BACKSPACE = 'backspace'
export const KEY_DELETE = 'delete'
export const KEY_UP = 'up'
export const KEY_DOWN = 'down'
export const KEY_LEFT = 'left'
export const KEY_RIGHT = 'right'
export const KEY_SPACE = 'space'

function isPrintableAscii(ch: string): boolean {
  if (ch.length !== 1) return false
  const code = ch.charCodeAt(0)
  return code >= 32 && code <= 126
}

/** Priority: arrows → return → escape → tab → backspace → delete → space → letter → raw input. */
function resolveKeyName(input: string, key: Key): string {
  if (key.upArrow) return KEY_UP
  if (key.downArrow) return KEY_DOWN
  if (key.leftArrow) return KEY_LEFT
  if (key.rightArrow) return KEY_RIGHT
  if (key.return) return KEY_ENTER
  if (key.escape) return KEY_ESCAPE
  if (key.tab) return KEY_TAB
  if (key.backspace) return KEY_BACKSPACE
  if (key.delete) return KEY_DELETE

  if (input === ' ') return KEY_SPACE

  if (input.length === 1) {
    const lower = input.toLowerCase()
    if (lower >= 'a' && lower <= 'z') return lower
  }

  return input
}

/**
 * Normalize Ink's raw `(input, key)` pair into a predictable {@link NormalizedKeyEvent}.
 * Pure utility — no React dependency, no side effects.
 */
export function normalizeKey(input: string, key: Key): NormalizedKeyEvent {
  const name = resolveKeyName(input, key)

  const printable = isPrintableAscii(input) && !key.ctrl && !key.meta

  const space = input === ' ' && !key.ctrl && !key.meta && !key.shift

  return {
    text: printable ? input : '',
    key: name,
    code: name, // Ink does not expose physical key codes
    isPrintable: printable,
    backspace: key.backspace,
    enter: key.return,
    escape: key.escape,
    tab: key.tab,
    space,
    up: key.upArrow,
    down: key.downArrow,
    left: key.leftArrow,
    right: key.rightArrow,
    ctrl: key.ctrl,
    shift: key.shift,
    alt: false, // Ink's Key type does not expose `alt`
    meta: key.meta,
    rawInput: input,
  }
}
