import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useStdin, useStdout } from 'ink'
import type { FocusScope } from '../types.js'
import { useKeyboardScope } from './KeyboardScopeProvider.js'
import { useNavigation } from '../navigation/NavigationProvider.js'
import {
  MouseInputParser,
  type SgrMousePacket,
} from './MouseInputParser.js'
import type { MouseBounds, MouseClickEvent } from './MouseArea.js'

/**
 * xterm mouse modes enabled while an interactive TTY is available: normal
 * tracking (`1000`, press/release only — no motion/hover/drag) plus SGR
 * extended coordinates (`1006`).
 */
export const MOUSE_ENABLE_SEQUENCE = '\u001B[?1000h\u001B[?1006h'

/** Balanced reset for {@link MOUSE_ENABLE_SEQUENCE}. */
export const MOUSE_RESET_SEQUENCE = '\u001B[?1000l\u001B[?1006l'

/**
 * How long a plausible `[<...` prefix is held before its original records are
 * replayed to the keyboard dispatcher. Must comfortably exceed Ink's own 20ms
 * partial-CSI flush so a report split across flushes can still assemble.
 */
export const DEFAULT_MOUSE_PREFIX_TIMEOUT_MS = 60

/**
 * Registration record shared between `MouseArea` and the provider registry.
 * `MouseArea` mutates the same record in place so bounds changes do not alter
 * registration order.
 */
export interface MouseAreaRegistration {
  /** Stable per-area id. */
  id: number
  bounds: MouseBounds
  scope?: FocusScope
  priority: number
  disabled: boolean
  onClick?: (event: MouseClickEvent) => void
}

interface RegisteredArea {
  area: MouseAreaRegistration
  /** Monotonic registration order; higher = more recently registered. */
  order: number
  /**
   * True when the area registered while a modal was already open. Such areas
   * belong to the modal layer even without an explicit `scope="modal"`;
   * background areas (registered before the modal opened) stay unreachable.
   */
  modalLayer: boolean
}

interface PendingPress {
  /**
   * Resolved press target entry, or `null` when the press hit no area. Stored
   * by entry identity: deleting or re-registering an area (even at the same
   * id and bounds) produces a different entry and cancels the press.
   */
  entry: RegisteredArea | null
  /** Whether the resolved target was disabled when the press happened. */
  disabled: boolean
  /**
   * Modal stack identity at press. Any modal change while the button is held
   * (open, close, or open+close) cancels activation.
   */
  modalStack: readonly unknown[]
}

/** Internal registry contract consumed by `MouseArea`. */
export interface MouseRegistryValue {
  /**
   * Register (or refresh) an area. Returns an idempotent unregister that also
   * cancels a pending press on the same area.
   */
  registerArea: (area: MouseAreaRegistration) => () => void
}

const MouseRegistryContext = createContext<MouseRegistryValue | null>(null)

/**
 * Whether a rectangle can participate in hit testing at all.
 *
 * Every component must be a finite safe integer and the extent must be
 * positive. `NaN`, `±Infinity` and fractional values would otherwise make the
 * half-open comparisons below pass vacuously (for example `x < NaN` is always
 * false), letting a single malformed area capture clicks across the whole
 * terminal.
 */
function isHittableBounds(bounds: MouseBounds): boolean {
  return (
    Number.isSafeInteger(bounds.x) &&
    Number.isSafeInteger(bounds.y) &&
    Number.isSafeInteger(bounds.width) &&
    Number.isSafeInteger(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

/** Internal hook; returns `null` outside `MouseProvider` so `MouseArea` is headless. */
export function useMouseRegistry(): MouseRegistryValue | null {
  return useContext(MouseRegistryContext)
}

export interface MouseProviderProps {
  children: ReactNode
  /**
   * Bounded prefix-assembly window in milliseconds. Internal/testing override;
   * the default is {@link DEFAULT_MOUSE_PREFIX_TIMEOUT_MS}.
   */
  prefixTimeoutMs?: number
}

function writeMouseReset(stdout: NodeJS.WriteStream): void {
  try {
    // Best-effort direct write: Ink's own writer ignores writes once an
    // unmount has started, but the terminal still needs the reset.
    if (stdout.destroyed || stdout.writableEnded) return
    stdout.write(MOUSE_RESET_SEQUENCE)
  } catch {
    // Teardown must never throw because a stream is already gone.
  }
}

/**
 * Owns the mouse area registry, SGR report routing and the TTY-gated mouse
 * reporting mode lifecycle.
 *
 * Dispatch rules:
 * - An area's bounds are absolute zero-based terminal cells, half-open
 *   `[x, x+width) × [y, y+height)`. A rectangle with a non-safe-integer or
 *   non-finite component, or a non-positive extent, is ignored entirely so it
 *   can never capture a click.
 * - While a modal is open, only modal areas are eligible and every click is
 *   consumed either way. Modal areas are those with an explicit
 *   `scope="modal"` plus areas that registered while the modal was already
 *   open (modal-rendered screens), so background areas stay unreachable.
 * - Otherwise an explicit scope must be active; an area without a scope
 *   resolves to the active/deepest scope at dispatch time and is eligible.
 *   `scope="modal"` areas stay dormant while no modal is open.
 * - Among eligible overlaps the highest explicit `priority` wins; ties go to
 *   the most recent registration. A disabled topmost target consumes without
 *   activating anything.
 * - A click fires only when press and release resolve to the same registered
 *   entry under unchanged routing: the modal stack must be identical to press
 *   time, the target must still be resolved at the release point, and it must
 *   not have been disabled at press nor be disabled at release. Deleting,
 *   re-registering (new entry, even for the same id and bounds), reordering,
 *   disabling or a scope change that reroutes the point between press and
 *   release cancels the stale activation; release alone never activates a
 *   target that was not pressed. Unregistering the press target cancels the
 *   pending press immediately.
 * - Only left press/release dispatch; all other valid SGR reports are
 *   consumed silently.
 *
 * Modal state comes from `useNavigation().isModalOpen` (the single owner of
 * the modal stack), not from keyboard scope membership: `ModalProvider`
 * keeps the `modal` scope registered for its escape handler even when no
 * modal is open.
 */
export function MouseProvider({ children, prefixTimeoutMs }: MouseProviderProps) {
  const { registerInputInterceptor, dispatchInputEvent, isScopeActive } =
    useKeyboardScope()
  const { isModalOpen, modalStack } = useNavigation()
  const { stdin, isRawModeSupported } = useStdin()
  const { stdout, write } = useStdout()

  const modalOpenRef = useRef(isModalOpen)
  modalOpenRef.current = isModalOpen
  const modalStackRef = useRef(modalStack)
  modalStackRef.current = modalStack

  const parserRef = useRef<MouseInputParser | null>(null)
  if (parserRef.current === null) {
    parserRef.current = new MouseInputParser()
  }

  const areasRef = useRef<Map<number, RegisteredArea>>(new Map())
  const orderRef = useRef(0)
  const pendingPressRef = useRef<PendingPress | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutMsRef = useRef(
    prefixTimeoutMs ?? DEFAULT_MOUSE_PREFIX_TIMEOUT_MS,
  )
  timeoutMsRef.current = prefixTimeoutMs ?? DEFAULT_MOUSE_PREFIX_TIMEOUT_MS

  // ── Area Registry ─────────────────────────────────────────────────

  const registerArea = useCallback((area: MouseAreaRegistration) => {
    const order = orderRef.current++
    areasRef.current.set(area.id, {
      area,
      order,
      modalLayer: modalOpenRef.current,
    })
    return () => {
      const current = areasRef.current.get(area.id)
      if (!current || current.area !== area) return
      areasRef.current.delete(area.id)
      if (pendingPressRef.current?.entry?.area.id === area.id) {
        pendingPressRef.current = null
      }
    }
  }, [])

  // ── Hit Testing / Dispatch ────────────────────────────────────────

  const findTarget = useCallback(
    (x: number, y: number): RegisteredArea | null => {
      const modalOpen = modalOpenRef.current
      let best: RegisteredArea | null = null
      for (const entry of areasRef.current.values()) {
        const { area } = entry
        // Malformed rectangles are not areas at all: ignoring them here keeps
        // them from ever winning hit testing or blocking valid targets below.
        if (!isHittableBounds(area.bounds)) continue
        if (modalOpen) {
          // Modal owns pointer routing: only explicit modal areas and areas
          // that registered into the modal layer are reachable; background
          // areas are unreachable even when no modal area covers the point.
          if (area.scope !== 'modal' && !entry.modalLayer) continue
        } else if (area.scope === 'modal') {
          // Modal areas are dormant unless a modal is open.
          continue
        } else if (area.scope !== undefined && !isScopeActive(area.scope)) {
          continue
        }
        const { bounds } = area
        if (x < bounds.x || x >= bounds.x + bounds.width) continue
        if (y < bounds.y || y >= bounds.y + bounds.height) continue
        if (
          best === null ||
          area.priority > best.area.priority ||
          (area.priority === best.area.priority && entry.order > best.order)
        ) {
          best = entry
        }
      }
      return best
    },
    [isScopeActive],
  )

  const handlePacket = useCallback(
    (packet: SgrMousePacket) => {
      // Supported left button only. Wheel (64+), extended buttons and other
      // bases are consumed but ignored.
      if (packet.button > 31) return
      const base = packet.button & 3
      const isPress = packet.kind === 'press' && base === 0
      const isRelease =
        packet.kind === 'release' && (base === 0 || base === 3)
      if (!isPress && !isRelease) return

      if (isPress) {
        const target = findTarget(packet.x, packet.y)
        pendingPressRef.current = {
          entry: target,
          disabled: target?.area.disabled ?? false,
          modalStack: modalStackRef.current,
        }
        return
      }

      const pending = pendingPressRef.current
      pendingPressRef.current = null
      if (!pending || pending.entry === null) return
      // Modal routing must be unchanged for the whole gesture: a modal
      // opening/closing between press and release (even an open+close cycle)
      // cancels the stale activation.
      if (modalStackRef.current !== pending.modalStack) return
      const target = findTarget(packet.x, packet.y)
      // Deletion, re-registration, reordering, a scope change that reroutes
      // the point and any other eligibility change all alter (or clear) the
      // resolved entry, so a stale target can never activate on release.
      if (target !== pending.entry) return
      // A target disabled at press, or disabled by release time, consumes the
      // gesture but must not activate.
      if (pending.disabled || target.area.disabled) return
      target.area.onClick?.({ x: packet.x, y: packet.y })
    },
    [findTarget],
  )

  // ── Prefix Timeout ────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const replayPendingRecords = useCallback(() => {
    const parser = parserRef.current
    if (!parser) return
    for (const record of parser.flush()) {
      dispatchInputEvent(record)
    }
  }, [dispatchInputEvent])

  const armTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      replayPendingRecords()
    }, timeoutMsRef.current)
  }, [clearTimer, replayPendingRecords])

  // ── Input Interception ────────────────────────────────────────────

  useEffect(() => {
    const parser = parserRef.current
    if (!parser) return
    return registerInputInterceptor((event) => {
      const update = parser.push(event)

      // Prefix became impossible/oversized: replay originals, in order,
      // through the ordinary keyboard dispatcher.
      for (const record of update.replay) {
        dispatchInputEvent(record)
      }

      if (update.packet) {
        clearTimer()
        handlePacket(update.packet)
        return true
      }
      if (update.held) {
        armTimer()
        return true
      }
      clearTimer()
      return false
    })
  }, [
    registerInputInterceptor,
    dispatchInputEvent,
    clearTimer,
    armTimer,
    handlePacket,
  ])

  // Unmount hygiene: timers must not outlive the provider.
  useEffect(
    () => () => {
      clearTimer()
      parserRef.current?.reset()
    },
    [clearTimer],
  )

  // ── Mouse Reporting Mode Lifecycle ────────────────────────────────

  const mouseReportingEnabled = Boolean(
    stdin.isTTY && isRawModeSupported && stdout.isTTY,
  )

  useEffect(() => {
    if (!mouseReportingEnabled) return
    write(MOUSE_ENABLE_SEQUENCE)
    let resetWritten = false
    return () => {
      // Idempotent: a second cleanup pass must not emit a second reset.
      if (resetWritten) return
      resetWritten = true
      writeMouseReset(stdout)
    }
  }, [mouseReportingEnabled, write, stdout])

  const registry = useMemo<MouseRegistryValue>(
    () => ({ registerArea }),
    [registerArea],
  )

  return (
    <MouseRegistryContext.Provider value={registry}>
      {children}
    </MouseRegistryContext.Provider>
  )
}
