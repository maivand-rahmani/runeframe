/**
 * Wire protocol for the Windows CONIN$ record helper.
 *
 * The native helper owns the console input queue (`CONIN$`) and writes one
 * JSON object per line to stdout; every diagnostic goes to stderr. The wire
 * format is shared by the production helper and the test-only harness:
 *
 *   {type:'ready', originalMode:int, mode:int}
 *   {type:'key', down:boolean, repeat:int, char:string, virtualKey:int,
 *    virtualScanCode:int|null, control:int}
 *   {type:'mouse', x:int, y:int, buttons:int, flags:int, control:int,
 *    windowLeft:int, windowTop:int}
 *   {type:'resize', columns:int, rows:int}
 *   {type:'error', message:string}
 *
 * `down` is a JSON boolean: the native side now serializes the 32-bit BOOL
 * correctly (int value plus a computed property), so JavaScript never coerces
 * a numeric truthiness here. Malformed JSON, unknown types and records with
 * missing required fields return `null` and are ignored, so one bad line can
 * never break the input path.
 */

/** Bounded protocol line length so a stuck helper cannot grow memory. */
export const MAX_HELPER_LINE_CHARS = 64 * 1024

export interface HelperReadyEvent {
  type: 'ready'
  originalMode: number
  mode: number
}

export interface HelperKeyEvent {
  type: 'key'
  /** `false` key-up records are ignored by the translation. */
  down: boolean
  /** `wRepeatCount`; applied as repeats of the translated bytes. */
  repeat: number
  /** `uChar.UnicodeChar` as a string (UTF-16 code unit, may be empty). */
  char: string
  /** `wVirtualKeyCode`. */
  virtualKey: number
  /**
   * `wVirtualScanCode`, or `null` when the helper did not report one. Never
   * coerced to `0`: an absent scan code cannot accidentally match a fallback.
   */
  virtualScanCode: number | null
  /** `dwControlKeyState` bitmask. */
  control: number
}

export interface HelperMouseEvent {
  type: 'mouse'
  /** Buffer coordinates (`dwMousePosition`). */
  x: number
  y: number
  /** `dwButtonState` (low bits buttons, high word wheel delta). */
  buttons: number
  /** `dwEventFlags` (motion/double-click/wheel bits). */
  flags: number
  /** `dwControlKeyState` bitmask. */
  control: number
  /** Viewport origin so screen-relative cells can be derived. */
  windowLeft: number
  windowTop: number
}

export interface HelperResizeEvent {
  type: 'resize'
  columns: number
  rows: number
}

export interface HelperErrorEvent {
  type: 'error'
  message: string
}

export type HelperEvent =
  | HelperReadyEvent
  | HelperKeyEvent
  | HelperMouseEvent
  | HelperResizeEvent
  | HelperErrorEvent

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

/**
 * Optional `wVirtualScanCode`. Missing or malformed values become `null`
 * (never `0`) so "no scan code reported" cannot silently match a fallback.
 */
function optionalScanCode(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.trunc(value)
}

/** Parse one protocol line; `null` for anything malformed or unknown. */
export function parseHelperEvent(line: string): HelperEvent | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  switch (record['type']) {
    case 'ready': {
      const originalMode = requiredNumber(record, 'originalMode')
      const mode = requiredNumber(record, 'mode')
      if (originalMode === null || mode === null) return null
      return { type: 'ready', originalMode, mode }
    }

    case 'key': {
      if (typeof record['down'] !== 'boolean') return null
      if (typeof record['char'] !== 'string') return null
      return {
        type: 'key',
        down: record['down'],
        repeat: optionalNumber(record, 'repeat', 1),
        char: record['char'],
        virtualKey: optionalNumber(record, 'virtualKey', 0),
        virtualScanCode: optionalScanCode(record['virtualScanCode']),
        control: optionalNumber(record, 'control', 0),
      }
    }

    case 'mouse': {
      const x = requiredNumber(record, 'x')
      const y = requiredNumber(record, 'y')
      const buttons = requiredNumber(record, 'buttons')
      const flags = requiredNumber(record, 'flags')
      if (x === null || y === null || buttons === null || flags === null) {
        return null
      }

      return {
        type: 'mouse',
        x,
        y,
        buttons,
        flags,
        control: optionalNumber(record, 'control', 0),
        windowLeft: optionalNumber(record, 'windowLeft', 0),
        windowTop: optionalNumber(record, 'windowTop', 0),
      }
    }

    case 'resize': {
      const columns = requiredNumber(record, 'columns')
      const rows = requiredNumber(record, 'rows')
      if (columns === null || rows === null) return null
      return { type: 'resize', columns, rows }
    }

    case 'error': {
      if (typeof record['message'] !== 'string') return null
      return { type: 'error', message: record['message'] }
    }

    default:
      return null
  }
}

/**
 * Append a chunk to the line buffer and return every complete line plus the
 * still-incomplete remainder. Empty lines are skipped; a lone `\r` at the end
 * of a line is trimmed so CRLF helpers work too.
 */
export function splitHelperLines(
  buffer: string,
  chunk: string,
): { lines: string[]; rest: string } {
  const segments = (buffer + chunk).split('\n')
  const rest = segments.pop() ?? ''
  const lines: string[] = []
  for (const segment of segments) {
    const line = segment.endsWith('\r') ? segment.slice(0, -1) : segment
    if (line.trim() !== '') lines.push(line)
  }
  return { lines, rest }
}
