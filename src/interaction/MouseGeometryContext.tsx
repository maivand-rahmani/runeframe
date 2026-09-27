import { createContext, useContext } from 'react'
import type { MouseBounds } from './MouseArea.js'

/**
 * Zero-based terminal-cell point. Integer and half-open when used as a
 * rectangle origin (see {@link MouseBounds}).
 */
export interface MouseGeometryPoint {
  readonly x: number
  readonly y: number
}

/**
 * Measured composition state shared with the descendants of a `MouseLayout`.
 *
 * The value describes where the immediately enclosing measured box starts in
 * absolute zero-based terminal cells and which root-owned rectangle clips it.
 *
 * Automatic mouse targets must stay inert while `origin` or `clip` is `null`.
 */
export interface MouseGeometryValue {
  /**
   * Absolute zero-based terminal-cell origin of the immediately enclosing
   * measured box. `null` while the anchored chain has not measured yet, when
   * no ancestor carries an explicit root `origin`, or when the assertion is
   * invalid. Automatic targets must not register usable bounds then.
   */
  readonly origin: MouseGeometryPoint | null
  /**
   * App-owned clip rectangle in absolute zero-based cells, anchored to the
   * measured bounds of the root `MouseLayout`. `null` until that root has
   * measured. Only the root rectangle is modeled in this slice; arbitrary
   * consumer overflow/scroll transforms are outside the contract.
   */
  readonly clip: MouseBounds | null
}

/** Internal provider surface for {@link MouseGeometryValue}. */
export const MouseGeometryContext = createContext<MouseGeometryValue | null>(
  null,
)

/**
 * Measured mouse-geometry state from the nearest `MouseLayout` ancestor.
 * Returns `null` outside any `MouseLayout`, so keyboard-only trees keep their
 * current behavior.
 */
export function useMouseGeometry(): MouseGeometryValue | null {
  return useContext(MouseGeometryContext)
}

/**
 * Round a Yoga layout value onto the integer terminal-cell grid.
 *
 * Yoga reports layout in (possibly fractional) layout units while SGR
 * coordinates and `MouseBounds` are integer terminal cells. `-0` is
 * normalized so resolved origins stay canonical.
 */
export function toMouseCell(value: number): number {
  const cell = Math.round(value)
  return cell === 0 ? 0 : cell
}

/**
 * Intersect a raw target rectangle with the app-owned clip rectangle.
 * Returns `null` when the intersection has no positive extent, meaning the
 * target is entirely clipped and must stay unreachable.
 */
export function clipMouseBounds(
  bounds: MouseBounds,
  clip: MouseBounds,
): MouseBounds | null {
  const x = Math.max(bounds.x, clip.x)
  const y = Math.max(bounds.y, clip.y)
  const right = Math.min(bounds.x + bounds.width, clip.x + clip.width)
  const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}
