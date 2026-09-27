import type { Key } from 'ink'

/**
 * One original Ink `useInput` callback invocation: the raw input string Ink
 * delivered (ESC already stripped for unrecognized CSI sequences) plus the
 * original key metadata object. Records are retained by reference so that a
 * replay preserves identity, order and metadata exactly.
 */
export interface MouseInputRecord {
  input: string
  key: Key
}

/** A complete, valid numeric xterm SGR mouse report (`[<Cb;Cx;CyM`/`m`). */
export interface SgrMousePacket {
  /** Raw button/modifier code from the report (left = 0, wheel = 64/65). */
  button: number
  /** Zero-based terminal column (SGR's one-based value minus one). */
  x: number
  /** Zero-based terminal row (SGR's one-based value minus one). */
  y: number
  /** `press` for final `M`, `release` for final `m`. */
  kind: 'press' | 'release'
}

/**
 * Result of feeding one record into {@link MouseInputParser}.
 *
 * - `replay`: original records that became impossible/oversized and must be
 *   routed through the ordinary keyboard dispatcher, unchanged and in order.
 * - `packet`: a complete recognized SGR packet that was consumed (never also
 *   routed to the keyboard dispatcher).
 * - `held`: the record was buffered as part of a plausible prefix; the caller
 *   must arm the bounded prefix timeout.
 *
 * When neither `packet` nor `held` is set, the current record must be
 * dispatched normally (after any `replay` records).
 */
export interface MouseParserUpdate {
  replay: MouseInputRecord[]
  packet: SgrMousePacket | null
  held: boolean
}

/** Maximum buffered prefix length before an input is declared impossible. */
export const SGR_MOUSE_MAX_PREFIX_LENGTH = 24

/** Maximum digits accepted per SGR numeric parameter. */
export const SGR_MOUSE_MAX_FIELD_DIGITS = 5

const COMPLETE_SGR_MOUSE_RE = /^\[<(\d{1,5});(\d{1,5});(\d{1,5})([Mm])$/

/**
 * Parse a complete SGR mouse report. Returns `null` for anything that is not
 * exactly one well-formed packet — never attempts to concatenate fragments.
 *
 * SGR reports coordinates one-based, so a raw `0` for the column or row can
 * never address a terminal cell and the report is rejected. The caller then
 * replays the original input records to the keyboard dispatcher instead of
 * consuming malformed input.
 *
 * Converts the one-based terminal coordinates to zero-based exactly once.
 */
export function parseSgrMousePacket(text: string): SgrMousePacket | null {
  const match = COMPLETE_SGR_MOUSE_RE.exec(text)
  if (!match) return null
  const button = Number.parseInt(match[1]!, 10)
  const column = Number.parseInt(match[2]!, 10)
  const row = Number.parseInt(match[3]!, 10)
  // One-based coordinates: 0 would otherwise underflow to a bogus -1.
  if (column < 1 || row < 1) return null
  return {
    button,
    x: column - 1,
    y: row - 1,
    kind: match[4] === 'M' ? 'press' : 'release',
  }
}

/**
 * Whether `text` could still become exactly one SGR mouse report when more
 * input arrives (`[`, `[<`, `[<12`, `[<12;`, `[<12;7`, ...).
 *
 * Bounded by {@link SGR_MOUSE_MAX_FIELD_DIGITS} and
 * {@link SGR_MOUSE_MAX_PREFIX_LENGTH}; anything else is immediately
 * impossible and must be replayed.
 */
export function isPlausibleMousePrefix(text: string): boolean {
  if (text.length === 0 || text.length > SGR_MOUSE_MAX_PREFIX_LENGTH) {
    return false
  }
  // A lone `[` is the only single-character prefix: after ESC stripping,
  // Ink may flush `\u001B[` as `[` before the rest of the report arrives.
  if (text === '[') return true
  if (!text.startsWith('[<')) return false
  const body = text.slice(2)
  if (body.length === 0) return true

  const parts = body.split(';')
  if (parts.length > 3) return false
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.length === 0) {
      // Only allowed while the parameter after a `;` has not started yet.
      return i === parts.length - 1 && i > 0
    }
    if (part.length > SGR_MOUSE_MAX_FIELD_DIGITS) return false
    for (let c = 0; c < part.length; c++) {
      const code = part.charCodeAt(c)
      if (code < 48 || code > 57) return false
    }
  }
  return true
}

/**
 * Pure SGR mouse input parser with bounded prefix buffering.
 *
 * Ink delivers each parsed input event separately through its single
 * `useInput` subscription. A mouse report is normally one complete event, but
 * Ink may flush a partial CSI after its own 20ms timeout, after which the
 * remaining bytes arrive as independent events. This parser keeps the
 * original records of a plausible `[<...` prefix and returns them for an
 * unchanged keyboard replay when the prefix can no longer become a packet,
 * grows past its bound, or times out ({@link flush}).
 *
 * It never synthesizes input from concatenated text and never drops key
 * metadata. Only complete valid numeric packets are consumed.
 */
export class MouseInputParser {
  private pendingText = ''
  private pendingRecords: MouseInputRecord[] = []

  /** Feed one original input record; returns what the caller must do with it. */
  push(record: MouseInputRecord): MouseParserUpdate {
    if (this.pendingRecords.length > 0) {
      const candidate = this.pendingText + record.input
      const packet = parseSgrMousePacket(candidate)
      if (packet) {
        this.clearPending()
        return { replay: [], packet, held: false }
      }
      if (isPlausibleMousePrefix(candidate)) {
        this.pendingText = candidate
        this.pendingRecords.push(record)
        return { replay: [], packet: null, held: true }
      }
      return this.classify(record, this.takePending())
    }
    return this.classify(record, [])
  }

  /** Whether a plausible prefix is currently buffered. */
  hasPending(): boolean {
    return this.pendingRecords.length > 0
  }

  /**
   * Abandon the buffered prefix and return its original records, in order.
   * Used for the bounded timeout path (and during cleanup).
   */
  flush(): MouseInputRecord[] {
    return this.takePending()
  }

  /** Drop any buffered prefix without returning it. */
  reset(): void {
    this.clearPending()
  }

  private classify(
    record: MouseInputRecord,
    replay: MouseInputRecord[],
  ): MouseParserUpdate {
    const packet = parseSgrMousePacket(record.input)
    if (packet) {
      return { replay, packet, held: false }
    }
    if (isPlausibleMousePrefix(record.input)) {
      this.pendingText = record.input
      this.pendingRecords = [record]
      return { replay, packet: null, held: true }
    }
    return { replay, packet: null, held: false }
  }

  private takePending(): MouseInputRecord[] {
    const records = this.pendingRecords
    this.clearPending()
    return records
  }

  private clearPending(): void {
    this.pendingText = ''
    this.pendingRecords = []
  }
}
