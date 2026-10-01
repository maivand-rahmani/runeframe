import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import {
  MAX_HELPER_LINE_CHARS,
  parseHelperEvent,
  splitHelperLines,
  type HelperEvent,
  type HelperKeyEvent,
  type HelperMouseEvent,
  type HelperReadyEvent,
} from './protocol.js'

/**
 * Byte source for the Windows CONIN$ record helper.
 *
 * Record-to-bytes translation for the helper's JSON protocol: keyboard
 * translation including Unicode surrogate pairs, ENHANCED_KEY scan-code
 * fallback, Ctrl+C control bytes and the stateful SGR mouse translation. The
 * helper's JSON records are translated into terminal bytes and pushed into one
 * Readable; the caller feeds that Readable into the shared SGR input
 * multiplexer, so there is no separate Windows mouse parser, event model or
 * hit testing here.
 *
 * The helper process is the sole owner of the console input queue: this module
 * never reads `process.stdin` and never calls `process.stdin.setRawMode`.
 * Startup and shutdown are bounded; a helper that has to be force-killed after
 * the bounded stop wait cannot run its own console-mode restoration, and the
 * transport says so explicitly.
 *
 * Motion records are reported as SGR motion: a move with the left button held
 * becomes the press-form `Cb = 32|modifiers`, a move with no button becomes
 * `Cb = 35|modifiers` (hover), and a move with only other buttons is ignored.
 * Motion never mutates the left press/release edge tracker, so a release is
 * still reported only when a press edge was seen first (no synthesized press,
 * release or click); horizontal wheel, right/middle buttons and
 * out-of-viewport points remain ignored.
 */

// ── Windows constants (wincon.h / winuser.h) ──────────────────────────

/** `dwControlKeyState` bits used for translation. */
export const WINDOWS_CONTROL_STATE = {
  RIGHT_ALT_PRESSED: 0x0001,
  LEFT_ALT_PRESSED: 0x0002,
  RIGHT_CTRL_PRESSED: 0x0004,
  LEFT_CTRL_PRESSED: 0x0008,
  SHIFT_PRESSED: 0x0010,
  NUMLOCK_ON: 0x0020,
  SCROLLLOCK_ON: 0x0040,
  CAPSLOCK_ON: 0x0080,
  ENHANCED_KEY: 0x0100,
} as const

export const WINDOWS_ALT_PRESSED =
  WINDOWS_CONTROL_STATE.RIGHT_ALT_PRESSED |
  WINDOWS_CONTROL_STATE.LEFT_ALT_PRESSED
export const WINDOWS_CTRL_PRESSED =
  WINDOWS_CONTROL_STATE.RIGHT_CTRL_PRESSED |
  WINDOWS_CONTROL_STATE.LEFT_CTRL_PRESSED
export const WINDOWS_SHIFT_PRESSED = WINDOWS_CONTROL_STATE.SHIFT_PRESSED

/** Virtual key codes used by the translation (`winuser.h`). */
export const WINDOWS_VIRTUAL_KEYS = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  ESCAPE: 0x1b,
  PRIOR: 0x21,
  NEXT: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  DELETE: 0x2e,
} as const

/** `dwEventFlags` bits (`wincon.h`). */
export const WINDOWS_MOUSE_FLAGS = {
  MOVED: 0x0001,
  DOUBLE_CLICK: 0x0002,
  WHEELED: 0x0004,
  HWHEELED: 0x0008,
} as const

/** `dwButtonState` bit for the left (first) button. */
export const WINDOWS_LEFT_BUTTON = 0x0001

/** SGR modifier bits: Shift 4, Meta 8, Ctrl 16. */
const SGR_SHIFT = 4
const SGR_META = 8
const SGR_CTRL = 16

/** SGR wheel base codes for wheel up/down. */
const SGR_WHEEL_UP = 64
const SGR_WHEEL_DOWN = 65

/** SGR motion base code while the left button is held: `32|modifiers`. */
const SGR_MOTION = 32

/**
 * SGR motion base code for a move with no button held: `32|3` (3 is SGR's "no
 * button" code), the xterm hover form.
 */
const SGR_NO_BUTTON_MOTION = 35

/** Low word of `dwButtonState`; the high word is wheel delta, not buttons. */
const WINDOWS_BUTTON_MASK = 0xffff

/** Bounded repeat application so a malformed record cannot flood the stream. */
export const MAX_KEY_REPEAT = 64

export const DEFAULT_READY_TIMEOUT_MS = 10_000
export const DEFAULT_STOP_TIMEOUT_MS = 2_000
export const DEFAULT_KILL_GRACE_MS = 1_000

/** Warning prefix for parent-visible transport diagnostics. */
export const WINDOWS_INPUT_WARNING_PREFIX = 'runeframe windows input:'

/**
 * Appended to failure messages and written to stderr when the helper was
 * force-killed: only the helper itself restores the original console input
 * mode, and a terminated process cannot run its finally block.
 */
export const FORCE_KILL_CAVEAT =
  'helper was force-killed after the bounded wait, so its console-mode restoration was not guaranteed'

// ── Key translation ───────────────────────────────────────────────────

export interface KeyTranslationState {
  /** High surrogate waiting for its low surrogate partner, or `''`. */
  pendingHighSurrogate: string
}

export function createKeyTranslationState(): KeyTranslationState {
  return { pendingHighSurrogate: '' }
}

interface KeyModifiers {
  alt: boolean
  ctrl: boolean
  shift: boolean
}

function isHighSurrogate(value: string): boolean {
  const code = value.charCodeAt(0)
  return value.length === 1 && code >= 0xd8_00 && code <= 0xdb_ff
}

function isLowSurrogate(value: string): boolean {
  const code = value.charCodeAt(0)
  return value.length === 1 && code >= 0xdc_00 && code <= 0xdf_ff
}

function xtermModifier(modifiers: KeyModifiers): number {
  return (
    1 +
    (modifiers.shift ? 1 : 0) +
    (modifiers.alt ? 2 : 0) +
    (modifiers.ctrl ? 4 : 0)
  )
}

/** Encode a navigation key, using the xterm modifier parameter when present. */
function encodeNavigation(base: string, modifier: number): string {
  if (base.endsWith('~')) {
    const number = base.slice(0, -1)
    return modifier === 1
      ? `\u001B[${number}~`
      : `\u001B[${number};${modifier}~`
  }
  return modifier === 1
    ? `\u001B[${base}`
    : `\u001B[1;${modifier}${base}`
}

const NAVIGATION_BASES: Record<number, string> = {
  [WINDOWS_VIRTUAL_KEYS.UP]: 'A',
  [WINDOWS_VIRTUAL_KEYS.DOWN]: 'B',
  [WINDOWS_VIRTUAL_KEYS.RIGHT]: 'C',
  [WINDOWS_VIRTUAL_KEYS.LEFT]: 'D',
  [WINDOWS_VIRTUAL_KEYS.HOME]: 'H',
  [WINDOWS_VIRTUAL_KEYS.END]: 'F',
  [WINDOWS_VIRTUAL_KEYS.PRIOR]: '5~',
  [WINDOWS_VIRTUAL_KEYS.NEXT]: '6~',
  [WINDOWS_VIRTUAL_KEYS.DELETE]: '3~',
}

/**
 * Enhanced gray navigation scan codes mapped to their virtual keys. Requiring
 * ENHANCED_KEY avoids guessing arrows from numpad records; a missing scan code
 * stays `null` and never participates.
 */
const ENHANCED_SCAN_CODE_VIRTUAL_KEYS: Record<number, number> = {
  0x48: WINDOWS_VIRTUAL_KEYS.UP,
  0x50: WINDOWS_VIRTUAL_KEYS.DOWN,
  0x4b: WINDOWS_VIRTUAL_KEYS.LEFT,
  0x4d: WINDOWS_VIRTUAL_KEYS.RIGHT,
  0x47: WINDOWS_VIRTUAL_KEYS.HOME,
  0x4f: WINDOWS_VIRTUAL_KEYS.END,
  0x49: WINDOWS_VIRTUAL_KEYS.PRIOR,
  0x51: WINDOWS_VIRTUAL_KEYS.NEXT,
  0x53: WINDOWS_VIRTUAL_KEYS.DELETE,
}

export function scanCodeFallbackVirtualKey(
  virtualScanCode: number | null,
  control: number,
): number | null {
  if (virtualScanCode === null || virtualScanCode === 0) return null
  if ((control & WINDOWS_CONTROL_STATE.ENHANCED_KEY) === 0) return null
  return ENHANCED_SCAN_CODE_VIRTUAL_KEYS[virtualScanCode] ?? null
}

function translateVirtualKey(
  virtualKey: number,
  modifiers: KeyModifiers,
): string {
  const base = NAVIGATION_BASES[virtualKey]
  if (base !== undefined) return encodeNavigation(base, xtermModifier(modifiers))
  switch (virtualKey) {
    case WINDOWS_VIRTUAL_KEYS.RETURN:
      return modifiers.alt ? '\u001B\r' : '\r'
    case WINDOWS_VIRTUAL_KEYS.TAB:
      return modifiers.shift ? '\u001B[Z' : '\t'
    case WINDOWS_VIRTUAL_KEYS.BACK:
      return modifiers.alt ? '\u001B\u007F' : '\u007F'
    case WINDOWS_VIRTUAL_KEYS.ESCAPE:
      return modifiers.alt ? '\u001B\u001B' : '\u001B'
    default:
      return ''
  }
}

/**
 * Translate one `uChar` value: surrogate pairs are joined across consecutive
 * key events, Ctrl+letter becomes the corresponding control byte, and Alt
 * prefixes ESC (the shape Ink's key parser reports as `meta`).
 */
function translateCharacter(
  char: string,
  modifiers: KeyModifiers,
  state: KeyTranslationState,
): string {
  let prefix = ''
  if (state.pendingHighSurrogate !== '') {
    if (isLowSurrogate(char)) {
      const combined = state.pendingHighSurrogate + char
      state.pendingHighSurrogate = ''
      return combine(prefix, combined, modifiers)
    }
    prefix = '\uFFFD'
    state.pendingHighSurrogate = ''
  }

  if (char === '') return prefix
  if (isHighSurrogate(char)) {
    state.pendingHighSurrogate = char
    return prefix
  }

  if (isLowSurrogate(char)) return `${prefix}\uFFFD`
  return combine(prefix, char, modifiers)
}

function combine(
  prefix: string,
  char: string,
  modifiers: KeyModifiers,
): string {
  if (modifiers.ctrl) {
    const code = char.charCodeAt(0)
    if (char.length === 1 && code >= 1 && code <= 26) {
      return prefix + char
    }

    if (char.length === 1) {
      const lower = char.toLowerCase()
      if (lower >= 'a' && lower <= 'z') {
        return prefix + String.fromCharCode(lower.charCodeAt(0) - 96)
      }
    }
  }

  return prefix + (modifiers.alt ? `\u001B${char}` : char)
}

function normalizeRepeat(repeat: number): number {
  if (!Number.isFinite(repeat) || repeat < 1) return 1
  return Math.min(Math.floor(repeat), MAX_KEY_REPEAT)
}

/**
 * Translate one helper key record into the terminal bytes Ink expects. Key-up
 * records produce `''` (nothing); repeats emit the sequence N times. When the
 * virtual key is unrecognized and `char` is empty, a scan-code fallback may
 * still recover gray navigation keys.
 */
export function translateKeyEvent(
  event: HelperKeyEvent,
  state: KeyTranslationState = createKeyTranslationState(),
): string {
  if (event.down !== true) return ''
  const modifiers: KeyModifiers = {
    alt: (event.control & WINDOWS_ALT_PRESSED) !== 0,
    ctrl: (event.control & WINDOWS_CTRL_PRESSED) !== 0,
    shift: (event.control & WINDOWS_SHIFT_PRESSED) !== 0,
  }

  let text = translateVirtualKey(event.virtualKey, modifiers)
  if (text === '') text = translateCharacter(event.char, modifiers, state)
  if (text === '' && event.char === '') {
    // Unrecognized virtual key with no character: try the conservative scan
    // code fallback instead of silently dropping the key.
    const fallbackVirtualKey = scanCodeFallbackVirtualKey(
      event.virtualScanCode,
      event.control,
    )
    if (fallbackVirtualKey !== null) {
      text = translateVirtualKey(fallbackVirtualKey, modifiers)
    }
  }

  if (text === '') return ''
  return text.repeat(normalizeRepeat(event.repeat))
}

// ── Mouse translation ─────────────────────────────────────────────────

export interface MouseTranslationState {
  /**
   * `dwButtonState` from the previously processed non-motion record. Motion
   * records deliberately do not update this, so the left press/release edge
   * pairing is preserved exactly as before.
   */
  previousButtons: number
}

export function createMouseTranslationState(): MouseTranslationState {
  return { previousButtons: 0 }
}

function sgrModifiers(control: number): number {
  let modifiers = 0
  if ((control & WINDOWS_SHIFT_PRESSED) !== 0) modifiers |= SGR_SHIFT
  if ((control & WINDOWS_ALT_PRESSED) !== 0) modifiers |= SGR_META
  if ((control & WINDOWS_CTRL_PRESSED) !== 0) modifiers |= SGR_CTRL
  return modifiers
}

/**
 * One SGR report. Windows reports buffer coordinates; the viewport origin is
 * subtracted to get screen cells, and SGR itself is one-based.
 */
function sgrMouseReport(
  button: number,
  event: HelperMouseEvent,
  finalChar: 'M' | 'm',
): string | null {
  const x = event.x - event.windowLeft
  const y = event.y - event.windowTop
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null
  if (x < 0 || y < 0 || x > 99_998 || y > 99_998) return null
  return `\u001B[<${button};${x + 1};${y + 1}${finalChar}`
}

/**
 * Translate one helper mouse record into an SGR report, or `null` when the
 * record must be ignored (motion with only other buttons held, right/middle
 * button presses/releases, horizontal wheel, out-of-viewport coordinates).
 *
 * Left press/release edges and vertical wheel are reported as before. Motion
 * is now reported as an SGR motion report (final `M`): `Cb = 32|modifiers`
 * while the left button is held (drag) and `Cb = 35|modifiers` for hover with
 * no button. Motion never synthesizes a press, a release or a click, and it
 * does not mutate the button-edge tracker, so a drag release is still paired
 * with the press edge that preceded the motion.
 */
export function translateMouseEvent(
  event: HelperMouseEvent,
  state: MouseTranslationState,
): string | null {
  const buttons = event.buttons >>> 0
  const previous = state.previousButtons >>> 0
  const flags = event.flags >>> 0
  const modifiers = sgrModifiers(event.control)

  if ((flags & WINDOWS_MOUSE_FLAGS.MOVED) !== 0) {
    // Motion is reported in press form and never as an edge: `32|modifiers`
    // with the left button held, `35|modifiers` (no button) while hovering.
    // Only other-button motion is ignored. The tracker is not updated here, so
    // a hover cannot invent a click and a drag release still pairs with its
    // press edge.
    if ((buttons & WINDOWS_LEFT_BUTTON) !== 0) {
      return sgrMouseReport(SGR_MOTION | modifiers, event, 'M')
    }
    if ((buttons & WINDOWS_BUTTON_MASK) === 0) {
      return sgrMouseReport(SGR_NO_BUTTON_MOTION | modifiers, event, 'M')
    }
    return null
  }

  let report: string | null = null
  if ((flags & WINDOWS_MOUSE_FLAGS.WHEELED) !== 0) {
    const delta = ((buttons >> 16) << 16) >> 16
    if (delta > 0) report = sgrMouseReport(SGR_WHEEL_UP | modifiers, event, 'M')
    else if (delta < 0) {
      report = sgrMouseReport(SGR_WHEEL_DOWN | modifiers, event, 'M')
    }
  } else if ((flags & WINDOWS_MOUSE_FLAGS.HWHEELED) === 0) {
    const isLeftDown = (buttons & WINDOWS_LEFT_BUTTON) !== 0
    const wasLeftDown = (previous & WINDOWS_LEFT_BUTTON) !== 0
    if (isLeftDown !== wasLeftDown) {
      report = sgrMouseReport(0 | modifiers, event, isLeftDown ? 'M' : 'm')
    }
  }

  state.previousButtons = buttons
  return report
}

// ── Helper process surface ────────────────────────────────────────────

type HelperListener = (...args: any[]) => void

export interface HelperProcessStdin {
  write(chunk: string): unknown
  end?(): unknown
  /** Present on real child-process pipes; used to swallow EPIPE after exit. */
  on?(event: string, listener: HelperListener): unknown
}

export interface HelperProcessStdout {
  setEncoding?(encoding: string): unknown
  on(event: string, listener: HelperListener): unknown
  removeListener?(event: string, listener: HelperListener): unknown
  /** Backpressure pass-through target. */
  pause?(): unknown
  resume?(): unknown
  /** Event-loop ref pass-through target. */
  ref?(): unknown
  unref?(): unknown
}

/**
 * Minimal structural slice of `ChildProcess` this module relies on. A real
 * `child_process.spawn` result satisfies it; tests supply fakes.
 */
export interface WindowsHelperProcess {
  readonly stdin: HelperProcessStdin
  readonly stdout: HelperProcessStdout
  readonly exitCode: number | null
  readonly pid?: number
  kill(signal?: string): boolean
  on(event: string, listener: HelperListener): unknown
  once(event: string, listener: HelperListener): unknown
  removeListener(event: string, listener: HelperListener): unknown
}

export interface WindowsHelperStartOptions {
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  killGraceMs?: number
  /** Diagnostics/warning sink; defaults to `process.stderr`. */
  stderr?: { write(chunk: string | Uint8Array): unknown }
  /** Injectable spawn (tests); defaults to `child_process.spawn`. */
  spawnHelper?: (executablePath: string) => WindowsHelperProcess
}

/** Result of a graceful-first helper shutdown attempt. */
export interface HelperShutdownOutcome {
  /** Whether a `stop` request was delivered to a still-running helper. */
  requestDelivered: boolean
  /**
   * True when the helper had to be force-killed after the bounded wait. A
   * force kill means the helper's finally block could not run, so its
   * console-mode restoration is NOT guaranteed.
   */
  forcedKill: boolean
}

function defaultSpawnHelper(executablePath: string): WindowsHelperProcess {
  const child = spawn(executablePath, [], {
    // stdin: control pipe (stop/EOF), stdout: JSON protocol, stderr: pass-through.
    // Do not use windowsHide: a hidden child can report ready but receive no
    // physical CONIN$ key/mouse records in Windows Terminal.
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return child as unknown as WindowsHelperProcess
}

function describeHelperExit(
  code: number | null,
  signal: string | null,
): string {
  const parts = [`code ${code === null ? 'null' : code}`]
  if (signal !== null) parts.push(`signal ${signal}`)
  return parts.join(', ')
}

function waitForHelperExit(
  child: WindowsHelperProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const onExit = (): void => {
      settled = true
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (settled) return
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

// ── Byte source ───────────────────────────────────────────────────────

/**
 * Ink/SGR-mux compatible byte source built from translated helper records.
 *
 * - `isTTY` is always `true` so Ink treats raw mode as supported.
 * - `setRawMode` is a no-op on the console (the helper owns the mode) and only
 *   records what the consumer asked for.
 * - `ref`/`unref` pass through to the helper stdout stream.
 * - Backpressure passes through: when `push()` reports a full buffer the
 *   helper stdout is paused, and the next `_read()` demand resumes it.
 * - Bytes are pushed exactly as translated; this class never parses SGR.
 */
export class WindowsInputByteSource extends Readable {
  /** Ink gates raw mode and mouse reporting on this. */
  readonly isTTY = true

  private readonly child: WindowsHelperProcess
  private readonly readyTimeoutMs: number
  private readonly stopTimeoutMs: number
  private readonly killGraceMs: number
  private readonly stderr: { write(chunk: string | Uint8Array): unknown }

  private readonly readyPromise: Promise<HelperReadyEvent>
  private readyResolve!: (event: HelperReadyEvent) => void
  private readyReject!: (error: Error) => void
  private readyEvent: HelperReadyEvent | null = null
  private readyFailure: Error | null = null
  private readyTimer: ReturnType<typeof setTimeout> | null = null

  private readonly keyState = createKeyTranslationState()
  private readonly mouseState = createMouseTranslationState()
  private lineBuffer = ''
  private stopping = false
  private failed = false
  private exitSeen = false
  private rawModeRequested = false
  private stdoutPaused = false
  private stopPromise: Promise<void> | null = null
  private shutdownPromise: Promise<HelperShutdownOutcome> | null = null
  private forceKillCaveatReported = false
  private terminalSize: { columns: number; rows: number } | null = null

  constructor(
    child: WindowsHelperProcess,
    options: WindowsHelperStartOptions = {},
  ) {
    super()
    this.child = child
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    this.stderr = options.stderr ?? process.stderr
    this.readyPromise = new Promise<HelperReadyEvent>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    // The factory always awaits this; keep a rejected promise from being
    // reported as unhandled if a caller drops it.
    void this.readyPromise.catch(() => {})
    // A failure can fire before the consumer attaches its own 'error'
    // listener (for example right after readiness). The visible stderr
    // warning is the primary signal; this keeps the stream error from
    // becoming an uncaught exception, and real listeners still receive it.
    this.on('error', () => {})
    this.wireHelper()
  }

  // ── Consumer surface ──────────────────────────────────────────────

  /** Resolves with the helper's `ready` record, rejects on startup failure. */
  waitForReady(): Promise<HelperReadyEvent> {
    return this.readyPromise
  }

  /** What the consumer last asked for; never the console state. */
  get isRawModeEnabled(): boolean {
    return this.rawModeRequested
  }

  /**
   * No-op on the console: the helper owns the real console input mode. Only
   * the consumer's request is recorded; `process.stdin` is never touched.
   */
  setRawMode(mode: boolean): void {
    this.rawModeRequested = mode === true
  }

  /** Pass-through to the helper stdout stream. */
  ref(): void {
    this.callStdout('ref')
  }

  /** Pass-through to the helper stdout stream. */
  unref(): void {
    this.callStdout('unref')
  }

  _read(_size: number): void {
    // Bytes arrive from the helper stdout pipe; a read demand only releases a
    // backpressure pause.
    if (this.stdoutPaused) {
      this.stdoutPaused = false
      this.callStdout('resume')
    }
  }

  /** Latest helper-reported console size, or `null` before any resize. */
  getSize(): { columns: number; rows: number } | null {
    return this.terminalSize === null ? null : { ...this.terminalSize }
  }

  /** Push translated terminal bytes into the readable buffer. */
  pushInput(text: string): void {
    if (this.destroyed || this.readableEnded || text === '') return
    if (!this.push(text)) {
      this.stdoutPaused = true
      this.callStdout('pause')
    }
  }

  // ── Helper event handling ─────────────────────────────────────────

  private wireHelper(): void {
    const stdout = this.child.stdout
    try {
      stdout.setEncoding?.('utf8')
    } catch {
      // Fall back to Buffer decoding in `handleStdoutData`.
    }

    stdout.on('data', this.handleStdoutData)
    stdout.on('error', this.handleStdoutError)
    stdout.on('end', this.handleStdoutEnd)
    // A write after the helper died (EPIPE) surfaces as a stream 'error'; the
    // shutdown path treats a failed request as "wait, then force kill".
    try {
      this.child.stdin.on?.('error', () => {
        // Expected during shutdown; never fatal on its own.
      })
    } catch {
      // Fakes without an event surface simply skip this.
    }

    this.child.once('exit', this.handleExit)
    this.child.once('error', this.handleProcessError)
    this.readyTimer = setTimeout(() => {
      this.failStartup(
        `windows input helper did not report ready within ${this.readyTimeoutMs}ms`,
      )
    }, this.readyTimeoutMs)
  }

  private handleStdoutData = (chunk: unknown): void => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString('utf8')
          : null
    if (text === null) return
    const { lines, rest } = splitHelperLines(this.lineBuffer, text)
    this.lineBuffer = rest
    if (rest.length > MAX_HELPER_LINE_CHARS) {
      this.failBeforeOrAfterReady(
        `windows input helper protocol line exceeded ${MAX_HELPER_LINE_CHARS} characters`,
      )
      return
    }

    for (const line of lines) {
      if (line.length > MAX_HELPER_LINE_CHARS) {
        this.failBeforeOrAfterReady(
          `windows input helper protocol line exceeded ${MAX_HELPER_LINE_CHARS} characters`,
        )
        return
      }

      const event = parseHelperEvent(line)
      if (event !== null) this.handleHelperEvent(event)
    }
  }

  private handleStdoutEnd = (): void => {
    if (this.stopping || this.failed || this.readyFailure !== null) return
    if (this.readyEvent === null) {
      this.failStartup('windows input helper stdout ended before ready')
    } else {
      this.failVisible('windows input helper stdout ended unexpectedly')
    }
  }

  private handleHelperEvent(event: HelperEvent): void {
    switch (event.type) {
      case 'ready': {
        if (
          this.readyEvent !== null ||
          this.readyFailure !== null ||
          this.failed
        ) {
          return
        }

        this.readyEvent = event
        this.clearReadyTimer()
        this.readyResolve(event)
        return
      }

      case 'key': {
        this.pushInput(translateKeyEvent(event, this.keyState))
        return
      }

      case 'mouse': {
        const report = translateMouseEvent(event, this.mouseState)
        if (report !== null) this.pushInput(report)
        return
      }

      case 'resize': {
        this.terminalSize = { columns: event.columns, rows: event.rows }
        this.emit('resize')
        return
      }

      case 'error': {
        if (this.readyEvent === null) {
          this.failStartup(`windows input helper error: ${event.message}`)
        } else {
          this.failVisible(`windows input helper error: ${event.message}`)
        }
        return
      }
    }
  }

  private handleExit = (code: number | null, signal: string | null): void => {
    this.exitSeen = true
    this.clearReadyTimer()
    if (this.stopping) {
      this.endReadable()
      return
    }

    if (this.readyFailure !== null) return
    const detail = describeHelperExit(code, signal)
    if (this.readyEvent === null) {
      this.failStartup(`windows input helper exited before ready (${detail})`)
    } else {
      this.failVisible(`windows input helper exited unexpectedly (${detail})`)
    }
  }

  private handleStdoutError = (error: Error): void => {
    const message = error instanceof Error ? error.message : String(error)
    if (this.stopping) {
      this.endReadable()
      return
    }

    if (this.readyEvent === null) {
      this.failStartup(`windows input helper protocol stream error: ${message}`)
    } else {
      this.failVisible(`windows input helper protocol stream error: ${message}`)
    }
  }

  private handleProcessError = (error: Error): void => {
    const message = error instanceof Error ? error.message : String(error)
    if (this.readyEvent === null) {
      this.failStartup(`windows input helper process error: ${message}`)
    } else {
      this.failVisible(`windows input helper process error: ${message}`)
    }
  }

  private failBeforeOrAfterReady(message: string): void {
    if (this.readyEvent === null) this.failStartup(message)
    else this.failVisible(message)
  }

  // ── Failure handling ──────────────────────────────────────────────

  /**
   * Startup failure (error record, timeout, spawn/stream error or early exit).
   *
   * The helper owns the console input mode and only its own finally block
   * restores it, so this never rejects readiness while the process may still
   * be running: it requests a graceful stop (`stop\n`), waits the bounded stop
   * timeout, and only then force-kills. Readiness rejects after the helper is
   * gone, so the caller cannot exit the app while the helper might still own
   * the mode. Never starts a fallback reader or a restart.
   */
  private failStartup(message: string): void {
    if (this.stopping || this.readyFailure !== null || this.readyEvent !== null) {
      return
    }

    const error = new Error(message)
    this.readyFailure = error
    this.clearReadyTimer()
    // The rejection is intentionally deferred; `readyPromise` already has a
    // no-op rejection handler, so nothing is unhandled while cleanup runs.
    void this.finishStartupFailure(error).catch(() => {})
  }

  private async finishStartupFailure(error: Error): Promise<void> {
    try {
      const outcome = await this.requestHelperShutdown()
      if (outcome.forcedKill) this.reportForceKillCaveat()
    } finally {
      this.readyReject(error)
      this.endReadable()
    }
  }

  /**
   * Post-ready failure: the app cannot function without its only console
   * reader, so it must fail visibly. Cleanup is graceful-first: request stop,
   * wait the bounded timeout, force-kill only afterwards, then emit an `error`
   * on the source so the multiplexer ends the Ink stream and the host can
   * unmount and await close.
   */
  private failVisible(message: string): void {
    if (this.failed || this.stopping) return
    this.failed = true
    this.clearReadyTimer()
    void this.finishVisibleFailure(message).catch(() => {})
  }

  private async finishVisibleFailure(message: string): Promise<void> {
    let text = message
    try {
      const outcome = await this.requestHelperShutdown()
      if (outcome.forcedKill) {
        // The failure message itself carries the caveat; mark it reported so
        // a concurrent `stop()` does not add a duplicate stderr warning.
        text = `${message} (${FORCE_KILL_CAVEAT})`
        this.forceKillCaveatReported = true
      }
    } finally {
      this.writeWarning(text)
      this.destroy(new Error(text))
    }
  }

  // ── Shutdown ──────────────────────────────────────────────────────

  /**
   * Ask the helper to restore the console and exit (`stop\n`), wait for it,
   * and only kill it after the timeout. Safe to call more than once; the same
   * graceful-first routine is shared by startup failures and visible failures,
   * and a forced kill on this path prints the same restoration caveat once.
   */
  stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise
    this.stopping = true
    this.clearReadyTimer()
    this.stopPromise = this.performStop()
    return this.stopPromise
  }

  private async performStop(): Promise<void> {
    const outcome = await this.requestHelperShutdown()
    if (outcome.forcedKill) {
      // A normal stop that needed a force kill is just as unsafe for console
      // mode restoration as a failure-path kill; report the same caveat once.
      this.reportForceKillCaveat()
    }

    if (this.readyEvent === null && this.readyFailure === null) {
      // A caller stopped the stream mid-startup: settle the pending readiness
      // promise instead of leaving it pending forever.
      const error = new Error(
        'windows input helper was stopped before it reported ready',
      )
      this.readyFailure = error
      this.readyReject(error)
    }

    this.endReadable()
  }

  /**
   * Single graceful-first shutdown attempt, shared by `stop()` and both
   * failure paths. Idempotent: the first caller performs the request/wait/kill
   * sequence; later callers await the same outcome.
   */
  private requestHelperShutdown(): Promise<HelperShutdownOutcome> {
    if (this.shutdownPromise !== null) return this.shutdownPromise
    this.shutdownPromise = this.performHelperShutdown()
    return this.shutdownPromise
  }

  private async performHelperShutdown(): Promise<HelperShutdownOutcome> {
    const running = !this.exitSeen && this.child.exitCode === null
    let requestDelivered = false
    if (running) {
      try {
        this.child.stdin.write('stop\n')
        requestDelivered = true
      } catch {
        // The control pipe is already gone; fall through to wait/kill.
      }
    }

    let forcedKill = false
    if (!this.exitSeen && this.child.exitCode === null) {
      const exited = await waitForHelperExit(this.child, this.stopTimeoutMs)
      if (!exited) {
        forcedKill = true
        this.killHelper('SIGTERM')
        const exitedAfterKill = await waitForHelperExit(
          this.child,
          this.killGraceMs,
        )
        if (!exitedAfterKill) this.killHelper('SIGKILL')
      }
    }

    return { requestDelivered, forcedKill }
  }

  private killHelper(signal: string): void {
    try {
      if (this.child.exitCode === null) this.child.kill(signal)
    } catch {
      // Best effort only.
    }
  }

  /**
   * Write the force-kill caveat to stderr at most once per source. Failure
   * paths and a timed-out normal stop share the same shutdown outcome, so a
   * guard prevents duplicate warnings when they overlap.
   */
  private reportForceKillCaveat(): void {
    if (this.forceKillCaveatReported) return
    this.forceKillCaveatReported = true
    this.writeWarning(FORCE_KILL_CAVEAT)
  }

  private writeWarning(message: string): void {
    try {
      this.stderr.write(`${WINDOWS_INPUT_WARNING_PREFIX} ${message}\n`)
    } catch {
      // Diagnostics must never mask the failure itself.
    }
  }

  private callStdout(method: 'pause' | 'resume' | 'ref' | 'unref'): void {
    const fn = this.child.stdout[method]
    if (typeof fn !== 'function') return
    try {
      ;(fn as () => unknown).call(this.child.stdout)
    } catch {
      // Stream state must never break the input path.
    }
  }

  private endReadable(): void {
    if (!this.readableEnded && !this.destroyed) this.push(null)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer === null) return
    clearTimeout(this.readyTimer)
    this.readyTimer = null
  }
}

// ── Startup ───────────────────────────────────────────────────────────

export interface WindowsHelperHandle {
  /** Byte source fed by translated helper records. */
  readonly source: NodeJS.ReadStream
  /** The `ready` record that satisfied startup. */
  readonly ready: HelperReadyEvent
  /** Graceful-first, idempotent shutdown of the helper process. */
  stop(): Promise<void>
}

/**
 * Spawn the helper and resolve once it reports ready. Any startup failure
 * rejects after a graceful stop attempt; the caller must not fall back to
 * `process.stdin`, because a surviving helper would compete with a second
 * console reader.
 */
export async function startWindowsHelperProcess(
  executablePath: string,
  options: WindowsHelperStartOptions = {},
): Promise<WindowsHelperHandle> {
  const spawnHelper = options.spawnHelper ?? defaultSpawnHelper
  let child: WindowsHelperProcess
  try {
    child = spawnHelper(executablePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`failed to spawn the Windows input helper: ${message}`)
  }

  const source = new WindowsInputByteSource(child, options)
  const ready = await source.waitForReady()
  return {
    source: source as unknown as NodeJS.ReadStream,
    ready,
    stop: () => source.stop(),
  }
}
