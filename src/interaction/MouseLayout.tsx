import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'
import { Box, useBoxMetrics, type BoxProps, type DOMElement } from 'ink'
import {
  MouseGeometryContext,
  toMouseCell,
  useMouseGeometry,
  type MouseGeometryValue,
} from './MouseGeometryContext.js'

/**
 * Consumer-asserted absolute origin in zero-based terminal cells for the root
 * `MouseLayout`: the terminal column/row of the box's top-left cell.
 */
export interface MouseLayoutOrigin {
  x: number
  y: number
}

export interface MouseLayoutProps extends BoxProps {
  children?: ReactNode
  /**
   * Root-only assertion. Supplying `origin` makes this instance an anchored
   * root; omitting it makes this instance a nested adapter that composes its
   * position from the nearest measured `MouseLayout` parent.
   *
   * Runeframe cannot verify the assertion. Alternate screen at `(0, 0)` is a
   * common anchor, not a library guarantee; the consumer owns its correctness.
   * Normal scrollback, `<Static>` output before the live tree, and
   * uncoordinated external writes are unsupported unless the consumer keeps a
   * correct origin. A supplied but invalid origin (non-finite, non-safe-integer
   * or fractional) leaves this subtree unanchored: automatic targets below it
   * stay inert and never inherit the parent geometry. Only an omitted `origin`
   * selects nested composition.
   */
  origin?: MouseLayoutOrigin
}

const UNMEASURED: MouseGeometryValue = { origin: null, clip: null }

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  if (ref != null) {
    ;(ref as { current: T | null }).current = value
  }
}

function isValidOrigin(
  origin: MouseLayoutOrigin | undefined,
): origin is MouseLayoutOrigin {
  return (
    origin != null &&
    Number.isSafeInteger(origin.x) &&
    Number.isSafeInteger(origin.y)
  )
}

/**
 * Box-equivalent layout adapter that measures its own public Ink `Box` and
 * composes absolute zero-based terminal-cell geometry for automatic mouse
 * targets.
 *
 * ## Supported tree precondition (documented, not runtime-validated)
 *
 * Only Ink's public `useBoxMetrics` is used; it reports positions relative to
 * the parent, so composition is only correct when every user-owned Ink `Box`
 * in the ancestry path from an automatic target to the anchored root is
 * replaced by a `MouseLayout` and every Runeframe-owned layout node in that
 * path is measured. Public Ink 7.0.3 cannot detect an omitted ordinary `Box`;
 * violating this precondition can yield plausible but incorrect coordinates
 * and is outside the automatic-geometry guarantee. No runtime validation or
 * fail-closed detection for such omissions is claimed.
 *
 * ## Behavior
 *
 * - Renders exactly one Ink `Box` (no additional layout node), preserves all
 *   `BoxProps`, and forwards/merges the consumer ref with its internal
 *   measurement ref.
 * - A root instance (`origin` supplied) publishes its asserted origin and uses
 *   its own measured width/height as the app-owned clip rectangle. A nested
 *   instance (no `origin`) composes its measured parent-relative offset into
 *   the parent's absolute origin and keeps the root clip. A supplied but
 *   invalid `origin` never degrades into nested composition: that subtree
 *   stays unanchored regardless of any valid parent.
 * - Until the root and every node in the chain have measured (`hasMeasured`),
 *   or when no valid anchored root exists, descendants receive no origin and
 *   automatic targets stay inert.
 * - Coordinates are integer, zero-based and half-open. Only explicitly
 *   modeled clips apply: the root `MouseLayout` rectangle in this slice.
 */
export const MouseLayout = forwardRef<DOMElement, MouseLayoutProps>(
  function MouseLayout({ origin, children, ...boxProps }, forwardedRef) {
    const parent = useMouseGeometry()
    const internalRef = useRef<DOMElement | null>(null)
    const metrics = useBoxMetrics(internalRef)

    const setRef = useCallback(
      (node: DOMElement | null) => {
        internalRef.current = node
        assignRef(forwardedRef, node)
      },
      [forwardedRef],
    )

    const anchored = isValidOrigin(origin)
    const originSupplied = origin !== undefined
    const originX = anchored ? origin.x : undefined
    const originY = anchored ? origin.y : undefined
    const parentOriginX = parent?.origin?.x
    const parentOriginY = parent?.origin?.y
    const parentClip = parent?.clip ?? null

    const geometry = useMemo<MouseGeometryValue>(() => {
      if (originX !== undefined && originY !== undefined) {
        // Anchored root: the consumer owns the absolute origin; the measured
        // size of this box is the app-owned clip.
        if (!metrics.hasMeasured) return UNMEASURED
        return {
          origin: { x: originX, y: originY },
          clip: {
            x: originX,
            y: originY,
            width: toMouseCell(metrics.width),
            height: toMouseCell(metrics.height),
          },
        }
      }

      // A supplied origin that failed validation must not silently degrade
      // into a nested adapter: the consumer asserted an anchor, and inheriting
      // parent geometry would hide the mistake behind plausible but wrong
      // coordinates. Keep the whole subtree unanchored instead.
      if (originSupplied) return UNMEASURED

      // Nested adapter: compose the measured parent-relative offset. Without
      // an anchored, measured parent the subtree stays inert.
      if (
        parentOriginX === undefined ||
        parentOriginY === undefined ||
        parentClip === null ||
        !metrics.hasMeasured
      ) {
        return { origin: null, clip: parentClip }
      }

      return {
        origin: {
          x: parentOriginX + toMouseCell(metrics.left),
          y: parentOriginY + toMouseCell(metrics.top),
        },
        clip: parentClip,
      }
    }, [
      originSupplied,
      originX,
      originY,
      parentOriginX,
      parentOriginY,
      parentClip,
      metrics.hasMeasured,
      metrics.left,
      metrics.top,
      metrics.width,
      metrics.height,
    ])

    return (
      <MouseGeometryContext.Provider value={geometry}>
        <Box ref={setRef} {...boxProps}>
          {children}
        </Box>
      </MouseGeometryContext.Provider>
    )
  },
)

MouseLayout.displayName = 'MouseLayout'
