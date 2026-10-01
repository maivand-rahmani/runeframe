import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'
import { Box, useBoxMetrics, type BoxProps, type DOMElement } from 'ink'
import type { FocusScope } from '../../types.js'
import type { MouseBounds } from './MouseArea.js'
import { allocateMouseAreaId } from './mouseAreaId.js'
import {
  MouseGeometryContext,
  clipMouseBounds,
  toMouseCell,
  useMouseGeometry,
  type MouseGeometryValue,
} from './MouseGeometryContext.js'
import type { AutoMouseMetrics } from './useAutoMouseArea.js'
import {
  useMouseRegistry,
  type MouseWheelDirection,
  type MouseWheelRegistration,
} from './MouseProvider.js'

/**
 * Non-hittable placeholder. `MouseProvider` ignores rectangles with a
 * non-positive extent, so a wheel record using these bounds is inert until a
 * valid viewport has been measured.
 */
const INERT_BOUNDS: MouseBounds = { x: 0, y: 0, width: 0, height: 0 }

export interface MouseScrollLayoutProps extends BoxProps {
  children?: ReactNode
  /**
   * Keyboard scope this viewport opts into. Omitted viewports resolve to the
   * active/deepest scope at dispatch time. While a modal is open a viewport
   * remains eligible if it has an explicit `scope="modal"` or registered while
   * the modal was already open; background viewports stay unreachable.
   */
  scope?: FocusScope
  /**
   * Overlap precedence among sibling viewports at the same explicit depth:
   * higher wins, ties go to the most recent registration. Explicit ancestry
   * always decides depth first, so priority never promotes a child over its
   * own ancestor.
   */
  priority?: number
  /**
   * Wheel handler. Returning `true` means this viewport scrolled and routing
   * stops; returning `false` (or supplying no handler) bubbles to the nearest
   * enclosing viewport. The wheel is consumed at the outer boundary and
   * whenever the explicit parent is missing or ineligible.
   *
   * Wheel handling never activates anything and never touches a pending
   * click press.
   */
  onWheel?: (direction: MouseWheelDirection) => boolean
}

/**
 * Composed geometry and wheel registration values for one viewport, resolved
 * purely from the enclosing geometry and this node's Ink metrics.
 */
export interface MouseScrollViewport {
  /** Geometry published to descendants (origin, clip and scroll ancestry). */
  readonly geometry: MouseGeometryValue
  /**
   * Wheel hit region in absolute cells: the measured viewport intersected with
   * every enclosing clip, or the inert rectangle while unmeasurable.
   */
  readonly bounds: MouseBounds
  /** Explicit nearest enclosing wheel-region id, `null` at the outer boundary. */
  readonly wheelParentId: number | null
}

/**
 * Translate the enclosing measured geometry plus this node's parent-relative
 * Ink metrics into an absolute viewport.
 *
 * - The composed absolute origin uses the same rules as a nested
 *   `MouseLayout`: without an anchored, measured, clipped parent chain the
 *   viewport stays inert (`origin` and `bounds` are not usable).
 * - The published descendant clip is the measured rectangle intersected with
 *   the enclosing clip, so automatic targets scrolled outside the viewport are
 *   never hittable. A fully clipped viewport publishes `clip: null`.
 * - The scroll ancestry is the enclosing ancestry plus this node's own id.
 *   The explicit parent id is the last enclosing id, never inferred from
 *   registration order.
 */
export function resolveMouseScrollViewport(
  parent: MouseGeometryValue | null,
  metrics: AutoMouseMetrics,
  ownId: number,
): MouseScrollViewport {
  const parentOrigin = parent?.origin ?? null
  const parentClip = parent?.clip ?? null
  const parentAncestors = parent?.scrollAncestors ?? []
  const scrollAncestors = [...parentAncestors, ownId]
  const wheelParentId =
    parentAncestors.length > 0
      ? parentAncestors[parentAncestors.length - 1]!
      : null

  // Unanchored chain or unmeasured node: no absolute viewport exists yet.
  // Descendants stay inert because `origin` is null, while `clip` keeps the
  // enclosing clip for informational parity with `MouseLayout`.
  if (parentOrigin === null || parentClip === null || !metrics.hasMeasured) {
    return {
      geometry: { origin: null, clip: parentClip, scrollAncestors },
      bounds: INERT_BOUNDS,
      wheelParentId,
    }
  }

  const raw: MouseBounds = {
    x: parentOrigin.x + toMouseCell(metrics.left),
    y: parentOrigin.y + toMouseCell(metrics.top),
    width: toMouseCell(metrics.width),
    height: toMouseCell(metrics.height),
  }

  // A non-positive measured extent is not a viewport: the subtree is inert
  // (`clip: null`) even though the origin itself is well defined.
  if (raw.width <= 0 || raw.height <= 0) {
    return {
      geometry: {
        origin: { x: raw.x, y: raw.y },
        clip: null,
        scrollAncestors,
      },
      bounds: INERT_BOUNDS,
      wheelParentId,
    }
  }

  const visible = clipMouseBounds(raw, parentClip)
  return {
    geometry: {
      origin: { x: raw.x, y: raw.y },
      clip: visible,
      scrollAncestors,
    },
    bounds: visible ?? INERT_BOUNDS,
    wheelParentId,
  }
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  if (ref != null) {
    ;(ref as { current: T | null }).current = value
  }
}

/**
 * Box-equivalent scroll viewport adapter: renders exactly one existing Ink
 * `Box` (no extra layout node, all `BoxProps` preserved, consumer ref merged
 * with the internal measurement ref) and registers itself as a wheel-only
 * region in the central mouse registry.
 *
 * ## Geometry
 *
 * Composition follows the `MouseLayout` contract: only Ink's public
 * `useBoxMetrics` is used, every user-owned Ink `Box` on the path from a
 * descendant target to the anchored root must be replaced by a
 * `MouseLayout`/`MouseScrollLayout`, and the same documented precondition
 * applies (omitted ordinary `Box` ancestors cannot be runtime-detected with
 * public Ink 7.0.3 APIs). Outside an anchored measured chain the viewport and
 * its descendants stay inert while keyboard behavior is unchanged.
 *
 * The composed viewport publishes its visible clip through
 * `MouseGeometryContext`, so descendant automatic targets clipped by the
 * viewport are not hittable; the scroll ancestry is published alongside it.
 *
 * ## Routing
 *
 * - Wheel-only: never considered by click hit testing, so a viewport never
 *   shadows explicit or automatic click targets.
 * - The deepest eligible viewport under the pointer receives the wheel first;
 *   `onWheel` returning `false` bubbles to the explicit nearest enclosing
 *   viewport. A missing or ineligible parent consumes the wheel, so routing
 *   can never escape modal/scope eligibility.
 * - The viewport's own `bounds` are its visible rectangle, so a partially
 *   clipped viewport never captures the wheel outside the visible area.
 *
 * Registry-visible fields are installed only from a commit-phase layout
 * effect while the registration record identity (and therefore id and
 * registration order) stays stable across measurement updates.
 */
export const MouseScrollLayout = forwardRef<DOMElement, MouseScrollLayoutProps>(
  function MouseScrollLayout(
    { onWheel, scope, priority = 0, children, ...boxProps },
    forwardedRef,
  ) {
    const registry = useMouseRegistry()
    const parent = useMouseGeometry()
    const internalRef = useRef<DOMElement | null>(null)
    const metrics = useBoxMetrics(internalRef)

    const recordRef = useRef<MouseWheelRegistration | null>(null)
    if (recordRef.current === null) {
      // One record per instance, allocated inert: id and registration order
      // must not move while the measured viewport changes.
      recordRef.current = {
        id: allocateMouseAreaId(),
        bounds: INERT_BOUNDS,
        scope,
        priority,
        wheelOnly: true,
        wheelParentId: null,
      }
    }
    const record = recordRef.current

    const setRef = useCallback(
      (node: DOMElement | null) => {
        internalRef.current = node
        assignRef(forwardedRef, node)
      },
      [forwardedRef],
    )

    const { hasMeasured, left, top, width, height } = metrics
    const viewport = useMemo(
      () =>
        resolveMouseScrollViewport(
          parent,
          { hasMeasured, left, top, width, height },
          record.id,
        ),
      [parent, hasMeasured, left, top, width, height, record],
    )

    // Render phase only prepares values. This commit-phase effect installs
    // them together, so a render React abandons can never move the viewport,
    // change its ancestry or swap its wheel handler.
    useLayoutEffect(() => {
      record.bounds = viewport.bounds
      record.scope = scope
      record.priority = priority
      record.wheelParentId = viewport.wheelParentId
      record.onWheel = onWheel
    })

    // Registration is commit-synchronous for the same reason as `MouseArea`:
    // a wheel report can arrive right after the frame that first shows this
    // viewport, before passive effects flush.
    useLayoutEffect(() => {
      if (!registry) return
      return registry.registerWheelRegion(record)
    }, [registry, record])

    return (
      <MouseGeometryContext.Provider value={viewport.geometry}>
        <Box ref={setRef} {...boxProps}>
          {children}
        </Box>
      </MouseGeometryContext.Provider>
    )
  },
)

MouseScrollLayout.displayName = 'MouseScrollLayout'
