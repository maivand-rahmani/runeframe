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
import type { FocusScope } from '../../types.js'
import { useKeyboardScope } from '../keyboard/KeyboardScopeProvider.js'
import { useNavigation } from '../../navigation/NavigationProvider.js'
import {
  decodeWheelDirection,
  MouseInputParser,
  type MouseWheelDirection,
  type SgrMousePacket,
} from './MouseInputParser.js'
import type { MouseBounds, MouseClickEvent } from './MouseArea.js'
import type { MouseEventSource } from './MouseEventSource.js'
import type { NormalizedMouseEvent } from './SgrMouseStreamParser.js'

/** Wheel directions recognized by `decodeWheelDirection`. */
export type { MouseWheelDirection } from './MouseInputParser.js'

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
  /** Discriminator reserved for wheel-only records; click areas leave it unset. */
  wheelOnly?: false
}

/**
 * Wheel-only registration record owned by `MouseScrollLayout`. Mutated in
 * place across commits so its id and registration order stay stable while the
 * measured viewport moves.
 */
export interface MouseWheelRegistration {
  /** Stable per-area id, allocated from the shared mouse-area allocator. */
  id: number
  /**
   * Visible viewport rectangle in absolute zero-based cells: the measured box
   * intersected with every enclosing clip. Wheel hit testing uses this rect.
   */
  bounds: MouseBounds
  scope?: FocusScope
  /** Sibling overlap precedence; higher wins, ties go to later registration. */
  priority: number
  /** Discriminates wheel-only regions from click areas. */
  wheelOnly: true
  /**
   * Explicit id of the nearest enclosing wheel-only region, or `null` when
   * this region is an outer boundary. Routing follows this link only; nested
   * scroll depth is never inferred from registration order.
   */
  wheelParentId: number | null
  /**
   * Called with the wheel direction while this viewport is the deepest
   * eligible region under the pointer. Returning `true` means the viewport
   * moved and routing stops; `false` bubbles to the explicit parent region.
   * Missing handlers never move, so the wheel bubbles like a `false` result.
   */
  onWheel?: (direction: MouseWheelDirection) => boolean
}

/** Every record the central registry can hold. */
export type MouseRegistration = MouseAreaRegistration | MouseWheelRegistration

/** Type guard: click areas participate in hit testing, wheel regions never do. */
export function isWheelRegion(
  registration: MouseRegistration,
): registration is MouseWheelRegistration {
  return registration.wheelOnly === true
}

interface RegisteredArea {
  area: MouseRegistration
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

/** Internal registry contract consumed by `MouseArea` and `MouseScrollLayout`. */
export interface MouseRegistryValue {
  /**
   * Register (or refresh) a click area. Returns an idempotent unregister that
   * also cancels a pending press on the same area.
   */
  registerArea: (area: MouseAreaRegistration) => () => void
  /**
   * Register (or refresh) a wheel-only region in the same central registry.
   * Wheel-only records never participate in click hit testing. Returns an
   * idempotent unregister.
   */
  registerWheelRegion: (area: MouseWheelRegistration) => () => void
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

/** Half-open point-in-rectangle test shared by click and wheel routing. */
function containsPoint(bounds: MouseBounds, x: number, y: number): boolean {
  return (
    x >= bounds.x &&
    x < bounds.x + bounds.width &&
    y >= bounds.y &&
    y < bounds.y + bounds.height
  )
}

/** Internal hook; returns `null` outside `MouseProvider` so `MouseArea` is headless. */
export function useMouseRegistry(): MouseRegistryValue | null {
  return useContext(MouseRegistryContext)
}

/**
 * Bounded snapshot of one registered area considered while routing a packet.
 * Contains only primitive metadata and bounds — never handler functions, and
 * never user text.
 */
export interface MouseAreaDiagnosticSnapshot {
  id: number
  bounds: MouseBounds
  priority: number
  disabled: boolean
  wheelOnly: boolean
  scope?: FocusScope
  /** Whether the pointer point falls inside the (valid) bounds. */
  contains: boolean
  /** Whether the area passed scope/modal eligibility at report time. */
  eligible: boolean
  /** `onClick` for click areas, `onWheel` for wheel-only regions. */
  hasHandler: boolean
}

export type MouseDiagnosticAction =
  | 'press'
  | 'release'
  | 'wheel-up'
  | 'wheel-down'

/** Why a packet dispatched or was consumed without activating anything. */
export type MouseDiagnosticReason =
  | 'press-pending'
  | 'press-disabled'
  | 'dispatched'
  | 'no-handler'
  | 'no-target'
  | 'no-pending-press'
  | 'press-had-no-target'
  | 'modal-changed'
  | 'missing-target'
  | 'target-changed'
  | 'disabled-at-press'
  | 'disabled-at-release'
  | 'not-clickable'
  | 'unsupported-button'
  | 'wheel-routed'
  | 'wheel-no-target'

/**
 * One opt-in routing diagnostic for a single SGR packet. Reports the packet
 * point/action, registered and eligible target counts, bounded area snapshots
 * (ids/bounds/flags), the chosen press/release target, cancellation reason and
 * whether `onClick` was actually invoked. Key text, handler functions and the
 * raw packet are never included.
 */
export interface MouseDiagnosticEvent {
  action: MouseDiagnosticAction
  /** Zero-based terminal cell from the packet. */
  x: number
  y: number
  /** All registered records (click areas plus wheel regions) at report time. */
  registeredCount: number
  /** Registered records of the relevant kind (click for press/release, wheel for wheel). */
  areaCount: number
  /** Relevant-kind areas that passed scope/modal eligibility. */
  eligibleCount: number
  /** Relevant-kind areas whose bounds contain the point. */
  containingCount: number
  /** Id of the resolved target, or `null` when none resolved. */
  targetId: number | null
  /** Id of the target resolved at press time (release reports only). */
  pressedTargetId?: number | null
  /** Whether `onClick` (or wheel routing) was invoked. */
  dispatched: boolean
  reason: MouseDiagnosticReason
  /** Modal state at report time. */
  modalOpen: boolean
  /** Bounded snapshots of relevant-kind areas that are eligible or contain the point. */
  areas: MouseAreaDiagnosticSnapshot[]
}

/** Cap on per-event area snapshots so diagnostics can never flood a log. */
export const MAX_DIAGNOSTIC_AREA_SNAPSHOTS = 16

export interface MouseProviderProps {
  children: ReactNode
  /**
   * Bounded prefix-assembly window in milliseconds. Internal/testing override;
   * the default is {@link DEFAULT_MOUSE_PREFIX_TIMEOUT_MS}.
   */
  prefixTimeoutMs?: number
  /**
   * Optional opt-in routing diagnostics. Never called when omitted; callback
   * errors are swallowed so routing and activation are unaffected. The latest
   * callback from the most recent render is used.
   */
  diagnostics?: (event: MouseDiagnosticEvent) => void
  /**
   * Optional normalized mouse event source (for example a native input
   * multiplexer). When provided, clicks and wheel notches are consumed from
   * this channel and the legacy post-Ink SGR interceptor stays unregistered,
   * so a report delivered through both transports can never dispatch twice.
   * When omitted, routing is unchanged: the post-Ink SGR parser is the only
   * source. The provider never subscribes to `stdin` for this channel.
   */
  mouseEventSource?: MouseEventSource
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

/** SGR modifier bits (Shift 4, Meta 8, Ctrl 16) carried by button codes. */
const SGR_MODIFIER_SHIFT = 4
const SGR_MODIFIER_META = 8
const SGR_MODIFIER_CTRL = 16

/** SGR base codes of the wheel press reports the router recognizes. */
const SGR_WHEEL_UP = 64
const SGR_WHEEL_DOWN = 65

/**
 * Re-encode one normalized source event as the packet shape the single router
 * consumes. Modifier bits are preserved (they decorate wheel decoding but
 * never move the button base), so hit testing, press/release pairing,
 * modal/scope eligibility and wheel depth routing are shared with the post-Ink
 * SGR path by construction.
 */
function normalizedEventToPacket(event: NormalizedMouseEvent): SgrMousePacket {
  const modifiers =
    (event.shift ? SGR_MODIFIER_SHIFT : 0) |
    (event.alt ? SGR_MODIFIER_META : 0) |
    (event.ctrl ? SGR_MODIFIER_CTRL : 0)
  if (event.type === 'wheel') {
    return {
      button:
        (event.direction === 'up' ? SGR_WHEEL_UP : SGR_WHEEL_DOWN) | modifiers,
      x: event.x,
      y: event.y,
      kind: 'press',
    }
  }
  return {
    button: modifiers,
    x: event.x,
    y: event.y,
    kind: event.type,
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
 * - Wheel press reports (`64`/`65` plus modifiers) dispatch immediately with
 *   no release pairing and never touch the pending click press. Routing
 *   selects the deepest eligible wheel-only region containing the pointer,
 *   where depth comes from the explicit `wheelParentId` chain, never from
 *   registration order. When its handler reports no movement, routing bubbles
 *   to that explicit parent only if the parent is eligible too; a missing or
 *   ineligible parent stops routing (the modal/scope restriction is never
 *   escaped) and the wheel is consumed. An outer boundary or no target at all
 *   also consumes the report.
 * - Wheel-only regions never participate in click hit testing, and wheel
 *   dispatch never invokes `onClick`.
 * - Only left press/release and wheel presses dispatch; all other valid SGR
 *   reports are consumed silently.
 *
 * Modal state comes from `useNavigation().isModalOpen` (the single owner of
 * the modal stack), not from keyboard scope membership: `ModalProvider`
 * keeps the `modal` scope registered for its escape handler even when no
 * modal is open.
 */
export function MouseProvider({
  children,
  prefixTimeoutMs,
  diagnostics,
  mouseEventSource,
}: MouseProviderProps) {
  const { registerInputInterceptor, dispatchInputEvent, isScopeActive } =
    useKeyboardScope()
  const { isModalOpen, modalStack } = useNavigation()
  const { stdin, isRawModeSupported } = useStdin()
  const { stdout, write } = useStdout()

  const modalOpenRef = useRef(isModalOpen)
  modalOpenRef.current = isModalOpen
  const modalStackRef = useRef(modalStack)
  modalStackRef.current = modalStack

  // Opt-in diagnostics: the latest callback is used without re-creating any
  // routing closure, and a throwing sink can never affect routing.
  const diagnosticsRef = useRef(diagnostics)
  diagnosticsRef.current = diagnostics
  const reportDiagnostic = useCallback((event: MouseDiagnosticEvent) => {
    const sink = diagnosticsRef.current
    if (typeof sink !== 'function') return
    try {
      sink(event)
    } catch {
      // Diagnostics must never affect routing or activation.
    }
  }, [])

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

  /**
   * Shared registration for click areas and wheel-only regions: one Map, one
   * id space, one monotonic order. The record is stored by reference so
   * callers can mutate it in place across commits without moving it.
   */
  const register = useCallback((area: MouseRegistration) => {
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

  const registerArea: (area: MouseAreaRegistration) => () => void = register
  const registerWheelRegion: (area: MouseWheelRegistration) => () => void =
    register

  // ── Hit Testing / Dispatch ────────────────────────────────────────

  /**
   * Scope/modal eligibility shared by every click candidate and every wheel
   * region and fallback, so wheel routing can never escape a restriction that
   * click routing honors.
   */
  const isEligible = useCallback(
    (entry: RegisteredArea): boolean => {
      const { area } = entry
      if (modalOpenRef.current) {
        // Modal owns pointer routing: only explicit modal areas and areas
        // that registered into the modal layer are reachable; background
        // areas are unreachable even when no modal area covers the point.
        return area.scope === 'modal' || entry.modalLayer
      }
      // Modal areas are dormant unless a modal is open.
      if (area.scope === 'modal') return false
      // Otherwise an explicit scope must be active; a region without a scope
      // resolves to the active/deepest scope at dispatch time.
      return area.scope === undefined || isScopeActive(area.scope)
    },
    [isScopeActive],
  )

  const findTarget = useCallback(
    (x: number, y: number): RegisteredArea | null => {
      let best: RegisteredArea | null = null
      for (const entry of areasRef.current.values()) {
        const { area } = entry
        // Click hit testing ignores wheel-only regions entirely: a scroll
        // viewport never shadows an explicit or automatic click target.
        if (isWheelRegion(area)) continue
        // Malformed rectangles are not areas at all: ignoring them here keeps
        // them from ever winning hit testing or blocking valid targets below.
        if (!isHittableBounds(area.bounds)) continue
        if (!isEligible(entry)) continue
        if (!containsPoint(area.bounds, x, y)) continue
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
    [isEligible],
  )

  /**
   * Explicit ancestry depth: how many resolvable wheel parents sit above this
   * entry. Registration order never influences depth. Cycle-safe: a malformed
   * chain stops at the first repeated or missing id.
   */
  const wheelDepth = useCallback((entry: RegisteredArea): number => {
    const area = entry.area
    if (!isWheelRegion(area)) return 0
    let depth = 0
    let parentId = area.wheelParentId
    const seen = new Set<number>([area.id])
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = areasRef.current.get(parentId)
      if (!parent || !isWheelRegion(parent.area)) break
      depth += 1
      parentId = parent.area.wheelParentId
    }
    return depth
  }, [])

  const findWheelTarget = useCallback(
    (x: number, y: number): RegisteredArea | null => {
      let best: RegisteredArea | null = null
      let bestDepth = -1
      for (const entry of areasRef.current.values()) {
        const { area } = entry
        if (!isWheelRegion(area)) continue
        if (!isHittableBounds(area.bounds)) continue
        if (!isEligible(entry)) continue
        if (!containsPoint(area.bounds, x, y)) continue
        const depth = wheelDepth(entry)
        // The deepest explicit viewport wins; equal-depth siblings keep the
        // registry's priority-then-order rule.
        if (
          best === null ||
          depth > bestDepth ||
          (depth === bestDepth &&
            (area.priority > best.area.priority ||
              (area.priority === best.area.priority &&
                entry.order > best.order)))
        ) {
          best = entry
          bestDepth = depth
        }
      }
      return best
    },
    [isEligible, wheelDepth],
  )

  /**
   * Bounded diagnostic snapshot of the relevant-area landscape at one point.
   * Iterates the registry read-only; counts and ids/bounds/flags only — no
   * handlers and no text. Used exclusively by the opt-in diagnostics sink.
   */
  const collectDiagnosticAreas = useCallback(
    (x: number, y: number, kind: 'click' | 'wheel') => {
      let areaCount = 0
      let eligibleCount = 0
      let containingCount = 0
      const candidates: Array<{
        snapshot: MouseAreaDiagnosticSnapshot
        rank: number
      }> = []
      for (const entry of areasRef.current.values()) {
        const area = entry.area
        const wheelOnly = isWheelRegion(area)
        if (kind === 'click' ? wheelOnly : !wheelOnly) continue
        areaCount += 1
        if (!isHittableBounds(area.bounds)) continue
        const eligible = isEligible(entry)
        const contains = containsPoint(area.bounds, x, y)
        if (eligible) eligibleCount += 1
        if (contains) containingCount += 1
        if (!eligible && !contains) continue
        candidates.push({
          snapshot: {
            id: area.id,
            bounds: { ...area.bounds },
            priority: area.priority,
            // Only click areas carry `disabled`; wheel regions never do.
            disabled: isWheelRegion(area) ? false : area.disabled,
            wheelOnly,
            scope: area.scope,
            contains,
            eligible,
            hasHandler: isWheelRegion(area)
              ? area.onWheel !== undefined
              : area.onClick !== undefined,
          },
          rank: eligible && contains ? 2 : contains ? 1 : 0,
        })
      }
      candidates.sort(
        (a, b) => b.rank - a.rank || a.snapshot.id - b.snapshot.id,
      )
      return {
        areaCount,
        eligibleCount,
        containingCount,
        areas: candidates
          .slice(0, MAX_DIAGNOSTIC_AREA_SNAPSHOTS)
          .map((candidate) => candidate.snapshot),
      }
    },
    [isEligible],
  )

  /**
   * Snapshot collector that is a cheap no-op when no diagnostics sink is
   * configured, so the default routing path does no extra registry work.
   */
  const collectAreasIfEnabled = useCallback(
    (x: number, y: number, kind: 'click' | 'wheel') =>
      typeof diagnosticsRef.current === 'function'
        ? collectDiagnosticAreas(x, y, kind)
        : {
            areaCount: 0,
            eligibleCount: 0,
            containingCount: 0,
            areas: [] as MouseAreaDiagnosticSnapshot[],
          },
    [collectDiagnosticAreas],
  )

  /**
   * Route one wheel report: deepest eligible viewport first, then its explicit
   * parent chain while handlers report no movement. A missing or ineligible
   * parent consumes the wheel so modal/scope restrictions are never escaped;
   * an outer boundary and a report with no target are consumed as well.
   */
  const dispatchWheel = useCallback(
    (direction: MouseWheelDirection, x: number, y: number) => {
      // Each region is asked at most once: a malformed (cyclic) parent chain
      // consumes the wheel instead of recursing forever.
      const visited = new Set<number>()
      let target = findWheelTarget(x, y)
      while (target !== null) {
        const area = target.area
        if (!isWheelRegion(area)) return
        if (visited.has(area.id)) return
        visited.add(area.id)
        if (area.onWheel?.(direction) === true) return
        const parentId = area.wheelParentId
        if (parentId === null) return
        const parent = areasRef.current.get(parentId)
        if (!parent || !isWheelRegion(parent.area) || !isEligible(parent)) {
          return
        }
        target = parent
      }
    },
    [findWheelTarget, isEligible],
  )

  const handlePacket = useCallback(
    (packet: SgrMousePacket) => {
      // Wheel press reports dispatch before the generic `button > 31` filter,
      // have no release form and never touch the pending click press.
      const wheelDirection = decodeWheelDirection(packet)
      if (wheelDirection !== null) {
        // Diagnostics resolve the wheel target separately; routing itself
        // still runs through `dispatchWheel` unchanged.
        const wheelTarget = findWheelTarget(packet.x, packet.y)
        const wheelAreas = collectAreasIfEnabled(packet.x, packet.y, 'wheel')
        dispatchWheel(wheelDirection, packet.x, packet.y)
        reportDiagnostic({
          action: wheelDirection === 'up' ? 'wheel-up' : 'wheel-down',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: wheelAreas.areaCount,
          eligibleCount: wheelAreas.eligibleCount,
          containingCount: wheelAreas.containingCount,
          targetId: wheelTarget?.area.id ?? null,
          dispatched: wheelTarget !== null,
          reason: wheelTarget === null ? 'wheel-no-target' : 'wheel-routed',
          modalOpen: modalOpenRef.current,
          areas: wheelAreas.areas,
        })
        return
      }

      const clickAreas = collectAreasIfEnabled(packet.x, packet.y, 'click')
      const base = packet.button & 3
      const isPress = packet.kind === 'press' && base === 0
      const isRelease =
        packet.kind === 'release' && (base === 0 || base === 3)
      // Extended buttons and other bases are consumed but ignored.
      if (packet.button > 31 || (!isPress && !isRelease)) {
        reportDiagnostic({
          action: packet.kind,
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: null,
          dispatched: false,
          reason: 'unsupported-button',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }

      if (isPress) {
        const target = findTarget(packet.x, packet.y)
        const targetArea =
          target !== null && !isWheelRegion(target.area) ? target.area : null
        pendingPressRef.current = {
          entry: target,
          disabled: targetArea?.disabled ?? false,
          modalStack: modalStackRef.current,
        }
        reportDiagnostic({
          action: 'press',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: targetArea?.id ?? null,
          dispatched: false,
          reason:
            targetArea === null
              ? 'no-target'
              : targetArea.disabled
                ? 'press-disabled'
                : 'press-pending',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }

      const pending = pendingPressRef.current
      pendingPressRef.current = null
      const pressedTargetId = pending?.entry?.area.id ?? null
      if (!pending || pending.entry === null) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: null,
          pressedTargetId,
          dispatched: false,
          reason: pending === null ? 'no-pending-press' : 'press-had-no-target',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      // Modal routing must be unchanged for the whole gesture: a modal
      // opening/closing between press and release (even an open+close cycle)
      // cancels the stale activation.
      if (modalStackRef.current !== pending.modalStack) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: null,
          pressedTargetId,
          dispatched: false,
          reason: 'modal-changed',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      const target = findTarget(packet.x, packet.y)
      // Deletion, re-registration, reordering, a scope change that reroutes
      // the point and any other eligibility change all alter (or clear) the
      // resolved entry, so a stale target can never activate on release.
      if (target !== pending.entry) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: target?.area.id ?? null,
          pressedTargetId,
          dispatched: false,
          reason: target === null ? 'missing-target' : 'target-changed',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      const targetArea = !isWheelRegion(target.area) ? target.area : null
      if (targetArea === null) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: null,
          pressedTargetId,
          dispatched: false,
          reason: 'not-clickable',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      // A target disabled at press, or disabled by release time, consumes the
      // gesture but must not activate.
      if (pending.disabled || targetArea.disabled) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: targetArea.id,
          pressedTargetId,
          dispatched: false,
          reason: pending.disabled ? 'disabled-at-press' : 'disabled-at-release',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      // A matching, enabled target with no onClick consumes the gesture
      // exactly like the `onClick?.()` no-op always did.
      if (targetArea.onClick === undefined) {
        reportDiagnostic({
          action: 'release',
          x: packet.x,
          y: packet.y,
          registeredCount: areasRef.current.size,
          areaCount: clickAreas.areaCount,
          eligibleCount: clickAreas.eligibleCount,
          containingCount: clickAreas.containingCount,
          targetId: targetArea.id,
          pressedTargetId,
          dispatched: false,
          reason: 'no-handler',
          modalOpen: modalOpenRef.current,
          areas: clickAreas.areas,
        })
        return
      }
      targetArea.onClick({ x: packet.x, y: packet.y })
      reportDiagnostic({
        action: 'release',
        x: packet.x,
        y: packet.y,
        registeredCount: areasRef.current.size,
        areaCount: clickAreas.areaCount,
        eligibleCount: clickAreas.eligibleCount,
        containingCount: clickAreas.containingCount,
        targetId: targetArea.id,
        pressedTargetId,
        dispatched: true,
        reason: 'dispatched',
        modalOpen: modalOpenRef.current,
        areas: clickAreas.areas,
      })
    },
    [collectAreasIfEnabled, dispatchWheel, findTarget, findWheelTarget, reportDiagnostic],
  )

  /**
   * Normalized events from an external source re-enter the single packet
   * router, so every routing rule (hit testing, pairing, modal/scope
   * eligibility, wheel depth) is shared with the post-Ink path. The latest
   * closure is kept in a ref so the subscription below survives re-renders
   * without churning.
   */
  const handleNormalizedEvent = useCallback(
    (event: NormalizedMouseEvent) => {
      handlePacket(normalizedEventToPacket(event))
    },
    [handlePacket],
  )
  const handleNormalizedEventRef = useRef(handleNormalizedEvent)
  handleNormalizedEventRef.current = handleNormalizedEvent

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
    // A configured event source owns mouse routing: the post-Ink interceptor
    // stays unregistered, otherwise a report seen on both transports would be
    // routed once per transport.
    if (mouseEventSource !== undefined) return
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
    mouseEventSource,
    registerInputInterceptor,
    dispatchInputEvent,
    clearTimer,
    armTimer,
    handlePacket,
  ])

  // ── External Event Source ─────────────────────────────────────────

  useEffect(() => {
    if (mouseEventSource === undefined) return
    return mouseEventSource.subscribe((event) => {
      handleNormalizedEventRef.current(event)
    })
  }, [mouseEventSource])

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
    () => ({ registerArea, registerWheelRegion }),
    [registerArea, registerWheelRegion],
  )

  return (
    <MouseRegistryContext.Provider value={registry}>
      {children}
    </MouseRegistryContext.Provider>
  )
}
