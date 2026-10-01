import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { FocusScope } from '../../types.js'
import { allocateMouseAreaId } from './mouseAreaId.js'
import { useMouseRegistry, type MouseAreaRegistration } from './MouseProvider.js'

/**
 * Absolute terminal-cell rectangle in zero-based coordinates. Half-open:
 * `[x, x+width) × [y, y+height)`.
 */
export interface MouseBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Click payload with zero-based terminal-cell coordinates. */
export interface MouseClickEvent {
  x: number
  y: number
}

/** Pointer payload with zero-based terminal-cell coordinates. */
export interface MousePointerEvent {
  x: number
  y: number
}

/**
 * Drag payload with zero-based terminal-cell coordinates: the current pointer
 * cell plus the press cell the drag started from.
 */
export interface MouseDragEvent {
  x: number
  y: number
  startX: number
  startY: number
}

export interface MouseAreaProps {
  /**
   * Absolute zero-based terminal-cell rectangle supplied by the caller.
   * Runeframe never infers bounds from Ink/Yoga layout.
   */
  bounds: MouseBounds
  /**
   * Keyboard scope this area opts into. Omitted areas resolve to the
   * active/deepest keyboard scope at dispatch time. While a modal is open an
   * area remains eligible if it has an explicit `scope="modal"` or registered
   * while the modal was already open; areas registered before the modal
   * opened stay unreachable.
   */
  scope?: FocusScope
  /**
   * Overlap precedence: higher wins. Ties go to the most recently registered
   * area.
   */
  priority?: number
  /**
   * When true the area still wins hit-testing and consumes the click, but
   * never calls `onClick` and never passes through to areas underneath.
   */
  disabled?: boolean
  /** Fired when a matching left press and release land on this area. */
  onClick?: (event: MouseClickEvent) => void
  /**
   * Fired when motion resolves this area as the topmost eligible enabled
   * target under the pointer (the pointer entered it).
   */
  onEnter?: (event: MousePointerEvent) => void
  /** Fired when the pointer moves from this area to a different target. */
  onLeave?: (event: MousePointerEvent) => void
  /** Fired on every motion while this area is the hover target. */
  onMove?: (event: MousePointerEvent) => void
  /**
   * Fired when a left press on this area becomes a drag: the first motion that
   * reaches a different terminal cell than the press (zero threshold).
   */
  onDragStart?: (event: MouseDragEvent) => void
  /** Fired for every later motion, even outside this area's bounds. */
  onDragMove?: (event: MouseDragEvent) => void
  /** Fired when the drag is released; the click is suppressed. */
  onDragEnd?: (event: MouseDragEvent) => void
  /**
   * Fired when an in-flight drag is cancelled (disabled, unhittable, scope or
   * modal change, source change) while this area is still registered.
   */
  onDragCancel?: (event: MouseDragEvent) => void
  children?: ReactNode
}

/**
 * Headless mouse target: renders `children` unchanged and registers an
 * explicit absolute-cell rectangle with the surrounding `MouseProvider`.
 * Without a `MouseProvider` it renders children and does nothing.
 */
export function MouseArea({
  bounds,
  scope,
  priority = 0,
  disabled = false,
  onClick,
  onEnter,
  onLeave,
  onMove,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  children,
}: MouseAreaProps): ReactNode {
  const registry = useMouseRegistry()
  const recordRef = useRef<MouseAreaRegistration | null>(null)
  if (recordRef.current === null) {
    // One record per instance, allocated before any commit. `id` is fixed at
    // creation so registration order never moves; every other field is
    // installed by the commit-phase effect below.
    recordRef.current = {
      id: allocateMouseAreaId(),
      bounds,
      scope,
      priority,
      disabled,
    }
  }
  const record = recordRef.current

  // Commit-phase install: the same registration record (and therefore its id
  // and registration order) receives this commit's values and then notifies
  // the provider, so a render React abandons can never leak bounds, scope,
  // disabled state or callbacks into the registry, and a stationary pointer
  // is re-hit-tested when a routing-relevant field moved. Declared before
  // registration: on the initial commit the record already carries this
  // commit's values when it becomes registry-visible, keeping registration
  // commit-synchronous.
  useLayoutEffect(() => {
    record.bounds = bounds
    record.scope = scope
    record.priority = priority
    record.disabled = disabled
    record.onClick = onClick
    record.onEnter = onEnter
    record.onLeave = onLeave
    record.onMove = onMove
    record.onDragStart = onDragStart
    record.onDragMove = onDragMove
    record.onDragEnd = onDragEnd
    record.onDragCancel = onDragCancel
    registry?.notifyAreaChanged(record)
  })

  // Registration must be commit-synchronous: Ink can write a frame containing
  // this area (and a consumer can react to it) before passive effects flush,
  // so a click immediately after the first render would otherwise miss the
  // area. The cleanup still runs on unmount, cancelling a pending press via
  // the registry's idempotent unregister.
  useLayoutEffect(() => {
    if (!registry) return
    return registry.registerArea(record)
  }, [registry, record])

  return <>{children}</>
}
