import {
  decodeWheelDirection,
  parseSgrMousePacket,
  SGR_MOUSE_MAX_FIELD_DIGITS,
  type SgrMousePacket,
} from './MouseInputParser.js'

/**
 * Zero-based terminal coordinates and SGR modifier flags shared by every
 * {@link NormalizedMouseEvent} variant.
 */
export interface NormalizedMouseEventBase {
  /** Zero-based terminal column (SGR's one-based column minus one). */
  x: number
  /** Zero-based terminal row (SGR's one-based row minus one). */
  y: number
  /** Shift modifier bit (SGR bit 4). */
  shift: boolean
  /** Meta/Alt modifier bit (SGR bit 8). */
  alt: boolean
  /** Ctrl modifier bit (SGR bit 16). */
  ctrl: boolean
}

/** A supported button report. Only the left button is routed today. */
export interface NormalizedMouseButtonEvent extends NormalizedMouseEventBase {
  type: 'press' | 'release'
  button: 'left'
}

/** A supported wheel notch. Wheel reports exist only in press form. */
export interface NormalizedMouseWheelEvent extends NormalizedMouseEventBase {
  type: 'wheel'
  direction: 'up' | 'down'
}

/**
 * Mouse input normalized for the framework multiplexer: zero-based cell
 * coordinates, boolean modifier flags and a small discriminated union.
 */
export type NormalizedMouseEvent =
  | NormalizedMouseButtonEvent
  | NormalizedMouseWheelEvent

/** One ordered item returned by {@link SgrMouseStreamParser.push}. */
export type SgrMouseStreamOutput =
  | { type: 'keyboard'; data: Buffer }
  | { type: 'mouse'; event: NormalizedMouseEvent }

/**
 * Upper bound on a single `ESC[<...` candidate, in bytes. Candidates that grow
 * past this bound are replayed as literal bytes instead of being buffered.
 * A well-formed report can never exceed 21 bytes (`ESC[<` + three 5-digit
 * fields + two separators + final byte), so this is a defensive bound.
 */
export const SGR_MOUSE_MAX_CANDIDATE_BYTES = 32

/** ESC byte: introduces every CSI sequence. */
const ESC = 0x1b
/** `[` byte: second byte of a CSI sequence. */
const OPEN_BRACKET = 0x5b
/** `<` byte: introduces an SGR (1006) mouse report. */
const LESS_THAN = 0x3c
/** `;` byte: SGR parameter separator. */
const SEMICOLON = 0x3b
/** `M` final byte: button press (or wheel notch). */
const FINAL_PRESS = 0x4d
/** `m` final byte: button release. */
const FINAL_RELEASE = 0x6d
/** ASCII `0`/`9` bound the digit range accepted in SGR parameters. */
const DIGIT_ZERO = 0x30
const DIGIT_NINE = 0x39

/** SGR modifier bits that decorate a button code. */
const MODIFIER_SHIFT = 4
const MODIFIER_META = 8
const MODIFIER_CTRL = 16
const MODIFIER_MASK = MODIFIER_SHIFT | MODIFIER_META | MODIFIER_CTRL

type CandidateScan =
  | { kind: 'complete'; length: number }
  | { kind: 'incomplete' }
  | { kind: 'invalid'; offset: number }

/**
 * Structurally scan a buffer that starts with `ESC[<` and decide whether it
 * already contains a complete SGR report, is still a plausible prefix, or can
 * never become one.
 *
 * `invalid.offset` is the first byte that cannot be part of any report; bytes
 * before it are confirmed literal input and may be replayed, while the byte at
 * the offset is rescanned because it may start something new (for example an
 * `ESC` beginning another report).
 */
function scanCandidate(buffer: Buffer): CandidateScan {
  let index = 3
  let field = 0
  let digits = 0
  for (;;) {
    if (index >= SGR_MOUSE_MAX_CANDIDATE_BYTES) {
      return { kind: 'invalid', offset: SGR_MOUSE_MAX_CANDIDATE_BYTES }
    }
    if (index >= buffer.length) return { kind: 'incomplete' }
    const byte = buffer[index]!
    if (byte >= DIGIT_ZERO && byte <= DIGIT_NINE) {
      if (digits >= SGR_MOUSE_MAX_FIELD_DIGITS) {
        return { kind: 'invalid', offset: index }
      }
      digits += 1
      index += 1
      continue
    }
    if (byte === SEMICOLON) {
      // A separator needs a non-empty field before it, and only three
      // parameters (`Cb`, `Cx`, `Cy`) exist.
      if (digits === 0 || field === 2) return { kind: 'invalid', offset: index }
      field += 1
      digits = 0
      index += 1
      continue
    }
    if (byte === FINAL_PRESS || byte === FINAL_RELEASE) {
      if (field !== 2 || digits === 0) return { kind: 'invalid', offset: index }
      return { kind: 'complete', length: index + 1 }
    }
    return { kind: 'invalid', offset: index }
  }
}

/**
 * Map a validated packet onto the normalized union. Returns `null` for every
 * complete but unsupported report (middle/right buttons, motion, extra bits,
 * wheel-release forms); the caller consumes those silently.
 */
function normalizeMousePacket(
  packet: SgrMousePacket,
): NormalizedMouseEvent | null {
  const shift = (packet.button & MODIFIER_SHIFT) !== 0
  const alt = (packet.button & MODIFIER_META) !== 0
  const ctrl = (packet.button & MODIFIER_CTRL) !== 0
  // Bit 32 (motion) and bit 128 (extra buttons) survive this mask, so only a
  // bare left button code (0-3 with modifiers) normalizes to `left`.
  if ((packet.button & ~MODIFIER_MASK) === 0) {
    return {
      type: packet.kind,
      button: 'left',
      x: packet.x,
      y: packet.y,
      shift,
      alt,
      ctrl,
    }
  }
  const direction = decodeWheelDirection(packet)
  if (direction !== null) {
    return {
      type: 'wheel',
      direction,
      x: packet.x,
      y: packet.y,
      shift,
      alt,
      ctrl,
    }
  }
  return null
}

/**
 * Pure, bounded scanner for xterm SGR (1006) mouse reports in a raw byte
 * stream. It sits upstream of Ink's `useInput`: it receives whatever bytes
 * arrive (a TTY `data` chunk, a synthetic chunk in tests) and returns ordered
 * output items.
 *
 * - Supported reports (`ESC[<Cb;Cx;CyM`/`m` for the left button and wheel
 *   64/65, with Shift/Meta/Ctrl bits) become {@link NormalizedMouseEvent}s
 *   with one-based SGR coordinates converted to zero-based once.
 * - Other complete SGR reports (middle/right buttons, motion, extra bits,
 *   wheel-release forms) are consumed silently so they never leak as text.
 * - Every other byte — including malformed, zero-coordinate, oversized and
 *   still-incomplete candidates — is emitted exactly once as `keyboard` data,
 *   in stream order, so the caller can forward it unchanged.
 * - A candidate split across arbitrary chunk boundaries is held until it can
 *   be decided; {@link flush} releases held bytes for the timeout path.
 *
 * The parser performs no I/O, never touches `stdin` and never synthesizes
 * input from concatenated pieces.
 */
export class SgrMouseStreamParser {
  private pending: Buffer = Buffer.alloc(0)

  /**
   * Feed one chunk of raw bytes. Returns the ordered output produced by this
   * chunk; a candidate that is still undecided stays buffered.
   */
  push(chunk: Buffer): SgrMouseStreamOutput[] {
    const output: SgrMouseStreamOutput[] = []
    if (chunk.length > 0) {
      this.pending =
        this.pending.length === 0
          ? Buffer.from(chunk)
          : Buffer.concat([this.pending, chunk])
    }
    while (this.pending.length > 0) {
      const first = this.pending[0]!
      if (first !== ESC) {
        // Plain keyboard bytes up to the next ESC; no candidate can start
        // without an ESC, so they are safe to release immediately.
        this.emitKeyboard(output, 1)
        continue
      }
      if (this.pending.length < 2) break
      if (this.pending[1] !== OPEN_BRACKET) {
        this.emitKeyboard(output, 1)
        continue
      }
      if (this.pending.length < 3) break
      if (this.pending[2] !== LESS_THAN) {
        // A CSI sequence that cannot be an SGR report (`ESC[A`, `ESC[1;5C`,
        // ...): release it as keyboard bytes and rescan after it.
        this.emitKeyboard(output, 2)
        continue
      }
      const scan = scanCandidate(this.pending)
      if (scan.kind === 'incomplete') break
      if (scan.kind === 'invalid') {
        // Confirmed literal prefix; rescan from the failure byte, which may
        // itself start a new candidate.
        this.emitKeyboard(output, scan.offset)
        continue
      }
      this.consumePacket(output, scan.length)
    }
    return output
  }

  /** Whether bytes of an undecided candidate are currently buffered. */
  hasPending(): boolean {
    return this.pending.length > 0
  }

  /**
   * Take the buffered literal bytes (timeout/cleanup path). The buffer is
   * cleared, so each held byte is returned exactly once; an empty buffer means
   * there was nothing pending.
   */
  flush(): Buffer {
    const pending = this.pending
    this.pending = Buffer.alloc(0)
    return pending.length === 0 ? Buffer.alloc(0) : Buffer.from(pending)
  }

  /** Drop any buffered bytes without returning them. */
  reset(): void {
    this.pending = Buffer.alloc(0)
  }

  /**
   * Emit pending bytes `[0, next ESC at or after searchFrom)` as keyboard
   * data, copying them out and coalescing with a preceding keyboard item of
   * the same push call.
   */
  private emitKeyboard(
    output: SgrMouseStreamOutput[],
    searchFrom: number,
  ): void {
    const nextEscape = this.pending.indexOf(ESC, searchFrom)
    const end = nextEscape === -1 ? this.pending.length : nextEscape
    const data = Buffer.from(this.pending.subarray(0, end))
    this.pending = this.pending.subarray(end)
    this.appendKeyboard(output, data)
  }

  /** Consume a structurally complete candidate. */
  private consumePacket(
    output: SgrMouseStreamOutput[],
    length: number,
  ): void {
    const bytes = Buffer.from(this.pending.subarray(0, length))
    this.pending = this.pending.subarray(length)
    const packet = parseSgrMousePacket(bytes.toString('latin1').slice(1))
    if (packet === null) {
      // Complete-shaped but invalid (for example a zero coordinate, which is
      // impossible in one-based SGR): replay the exact bytes for the caller's
      // keyboard path instead of consuming them.
      this.appendKeyboard(output, bytes)
      return
    }
    const event = normalizeMousePacket(packet)
    if (event !== null) {
      output.push({ type: 'mouse', event })
    }
  }

  /** Append keyboard bytes, merging with the previous keyboard item. */
  private appendKeyboard(output: SgrMouseStreamOutput[], data: Buffer): void {
    const last = output[output.length - 1]
    if (last !== undefined && last.type === 'keyboard') {
      last.data = Buffer.concat([last.data, data])
      return
    }
    output.push({ type: 'keyboard', data })
  }
}
