import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useBoxMetrics, type DOMElement } from 'ink'
import type { FocusScope } from '../../types.js'
import type {
  MouseBounds,
  MouseClickEvent,
  MouseDragEvent,
  MousePointerEvent,
} from './MouseArea.js'
import { allocateMouseAreaId } from './mouseAreaId.js'
import type { MouseAreaRegistration } from './MouseProvider.js'
import { useMouseRegistry } from './MouseProvider.js'
import {
  clipMouseBounds,
  toMouseCell,
  useMouseGeometry,
  type MouseGeometryValue,
} from './MouseGeometryContext.js'

export interface UseAutoMouseAreaOptions {
  /** Consumes clicks without activating, matching explicit `MouseArea`. */
  disabled?: boolean
  /** Keyboard scope to opt into; omitted resolves at dispatch time. */
  scope?: FocusScope
  /** Overlap precedence: higher wins. */
  priority?: number
  /** Fired when a matching press and release land on the measured bounds. */
  onClick?: (event: MouseClickEvent) => void
  /** Fired when motion makes this measured area the hover target. */
  onEnter?: (event: MousePointerEvent) => void
  /** Fired when the pointer moves from this area to a different target. */
  onLeave?: (event: MousePointerEvent) => void
  /** Fired on every motion while this area is the hover target. */
  onMove?: (event: MousePointerEvent) => void
  /** Fired when a left press on the measured bounds becomes a drag. */
  onDragStart?: (event: MouseDragEvent) => void
  /** Fired for every later motion, even outside the measured bounds. */
  onDragMove?: (event: MouseDragEvent) => void
  /** Fired when the drag is released; the click is suppressed. */
  onDragEnd?: (event: MouseDragEvent) => void
  /** Fired when an in-flight drag is cancelled while this area is registered. */
  onDragCancel?: (event: MouseDragEvent) => void
}

/** Layout values reported by Ink's public `useBoxMetrics` for this node. */
export interface AutoMouseMetrics {
  left: number
  top: number
  width: number
  height: number
  hasMeasured: boolean
}

/**
 * Non-hittable placeholder. `MouseProvider` ignores rectangles with a
 * non-positive extent, so a record using these bounds is inert until valid
 * geometry is measured.
 */
const INERT_BOUNDS: MouseBounds = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Translate the surrounding measured geometry plus this node's parent-relative
 * Ink metrics into absolute zero-based half-open terminal-cell bounds.
 *
 * Returns `null` while the anchored chain or this node has not measured, and
 * when the raw rectangle is entirely outside the root clip. Partially clipped
 * rectangles are clamped so cells outside the app-owned root never hit.
 */
export function resolveAutoMouseBounds(
  geometry: MouseGeometryValue | null,
  metrics: AutoMouseMetrics,
): MouseBounds | null {
  const { origin, clip } = geometry ?? {
    origin: null,
    clip: null,
    scrollAncestors: [],
  }
  if (origin === null || clip === null || !metrics.hasMeasured) return null

  const raw: MouseBounds = {
    x: origin.x + toMouseCell(metrics.left),
    y: origin.y + toMouseCell(metrics.top),
    width: toMouseCell(metrics.width),
    height: toMouseCell(metrics.height),
  }
  if (raw.width <= 0 || raw.height <= 0) return null
  return clipMouseBounds(raw, clip)
}

/**
 * Mutable registration fields a commit installs on the stable record. `id` is
 * excluded: it is fixed at record creation so registration order never moves.
 */
export type AutoMouseAreaUpdate = Omit<MouseAreaRegistration, 'id'>

/**
 * Render-phase preparation for one commit: resolves the geometry and captures
 * the current options. Pure by construction — it never receives (and so can
 * never touch) the registration record, meaning a render that is abandoned
 * before commit cannot leak bounds, scope, priority, disabled state or
 * callbacks into the registry.
 */
export function prepareAutoMouseAreaUpdate(
  geometry: MouseGeometryValue | null,
  metrics: AutoMouseMetrics,
  options: UseAutoMouseAreaOptions,
): AutoMouseAreaUpdate {
  return {
    bounds: resolveAutoMouseBounds(geometry, metrics) ?? INERT_BOUNDS,
    scope: options.scope,
    priority: options.priority ?? 0,
    disabled: options.disabled ?? false,
    onClick: options.onClick,
    onEnter: options.onEnter,
    onLeave: options.onLeave,
    onMove: options.onMove,
    onDragStart: options.onDragStart,
    onDragMove: options.onDragMove,
    onDragEnd: options.onDragEnd,
    onDragCancel: options.onDragCancel,
  }
}

/**
 * Commit-phase install for one prepared update. Copies every field in a single
 * synchronous step so hit testing can never observe a partially updated area,
 * and preserves the record identity (and therefore its id and registration
 * order).
 */
export function commitAutoMouseAreaUpdate(
  record: MouseAreaRegistration,
  update: AutoMouseAreaUpdate,
): void {
  record.bounds = update.bounds
  record.scope = update.scope
  record.priority = update.priority
  record.disabled = update.disabled
  record.onClick = update.onClick
  record.onEnter = update.onEnter
  record.onLeave = update.onLeave
  record.onMove = update.onMove
  record.onDragStart = update.onDragStart
  record.onDragMove = update.onDragMove
  record.onDragEnd = update.onDragEnd
  record.onDragCancel = update.onDragCancel
}

/**
 * Instrument a measured node (attach the returned ref to a single Ink `Box`)
 * as an automatic mouse target registered through the shared
 * `MouseProvider` registry.
 *
 * Contract:
 * - The returned bounds come only from the public `useBoxMetrics` composition
 *   supplied by an anchored `MouseLayout` ancestry. Outside that supported
 *   tree the area stays inert; this hook performs no runtime validation of the
 *   documented ancestry precondition.
 * - The registration record is created once per component instance and
 *   registered once per registry, so its id and registration order stay stable
 *   while geometry changes.
 * - Render only prepares values; every registry-visible field is written in a
 *   commit-phase layout effect. Before the first valid measurement is
 *   committed the record is inert (non-positive extent), and on rerenders the
 *   previous committed values stay in place until commit, so an aborted or
 *   concurrent render can never expose geometry or callbacks early. The
 *   layout-effect cleanup removes the record on unmount or provider change.
 * - After every commit the provider is notified with the record; when the
 *   committed bounds, scope, priority or disabled state actually changed it
 *   queues one coalesced re-hit-test at the last pointer cell seen in a motion
 *   report (identity transitions only — no synthetic motion), so measured
 *   areas that move under a stationary pointer update hover without any
 *   further input.
 */
export function useAutoMouseArea(
  options: UseAutoMouseAreaOptions = {},
): RefObject<DOMElement | null> {
  const registry = useMouseRegistry()
  const geometry = useMouseGeometry()
  const ref = useRef<DOMElement | null>(null)
  const metrics = useBoxMetrics(ref)

  const recordRef = useRef<MouseAreaRegistration | null>(null)
  if (recordRef.current === null) {
    // One record per instance, allocated inert: the extent cannot hit-test
    // and the area is disabled until the commit effect installs real values.
    recordRef.current = {
      id: allocateMouseAreaId(),
      bounds: INERT_BOUNDS,
      priority: 0,
      disabled: true,
    }
  }
  const record = recordRef.current

  // Pending values are captured per render and applied only from that render's
  // commit effect below. React discards the effects of a render it abandons,
  // so pending geometry and callbacks cannot leak into the registry early.
  const update = prepareAutoMouseAreaUpdate(geometry, metrics, options)

  // Declared before registration: on the initial commit the record already
  // carries this commit's values when it becomes registry-visible, and on later
  // commits it moves from the previous committed state straight to the new one.
  // The change report follows the install, so the provider re-hit-tests the
  // last known pointer when committed geometry/scope/priority/disabled moved a
  // registered area (for example an AppShell scroll/resize). Callback-only
  // changes never schedule: the provider compares routing-relevant fields.
  useLayoutEffect(() => {
    commitAutoMouseAreaUpdate(record, update)
    registry?.notifyAreaChanged(record)
  })

  useLayoutEffect(() => {
    if (!registry) return
    return registry.registerArea(record)
  }, [registry, record])

  return ref
}
