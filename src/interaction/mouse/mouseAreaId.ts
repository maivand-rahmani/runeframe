/**
 * Process-wide allocator for mouse area registration ids.
 *
 * `MouseArea` (explicit bounds) and `useAutoMouseArea` (measured geometry)
 * register into the same `MouseProvider` registry, which is a `Map` keyed by
 * id. Both registration paths must draw from one counter so their ids can
 * never collide and silently replace one another in that Map.
 *
 * Internal only: never re-exported from the package entry points.
 */
let nextMouseAreaId = 0

/** Allocate the next unique mouse area registration id. */
export function allocateMouseAreaId(): number {
  return nextMouseAreaId++
}
