import type { Action } from './ActionRegistry.js'
import type { FocusScope, BuiltinFocusScope } from '../../types.js'

export interface CollisionWarning {
  /** The conflicting key string (e.g. 'b', 'enter', 'ctrl+p'). */
  key: string
  /** First action's scope. */
  scope1: string
  /** Second action's scope. */
  scope2: string
  /** The id of the first action that registers this key. */
  action1Id: string
  /** The id of the second action that registers this key. */
  action2Id: string
  /** Severity of the collision. */
  severity: 'warning' | 'error'
  /** Human-readable description of the conflict. */
  message: string
}

const BUILTIN_SCOPES: ReadonlySet<string> = new Set<BuiltinFocusScope>([
  'navigation',
  'list',
  'command',
  'modal',
  'textinput',
  'process',
])

function isBuiltinScope(scope: FocusScope): boolean {
  return BUILTIN_SCOPES.has(scope)
}

/**
 * Key group: all actions that share a particular key string.
 * Each entry in the group has the action, the scope (resolved), and the original
 * scope value.
 */
interface KeyGroupEntry {
  action: Action
  scope: FocusScope
}

/**
 * Detect conflicting hotkey registrations across a set of actions.
 *
 * Algorithm:
 * 1. Collect all actions that have a `keys` array and a `scope`.
 * 2. Group actions by each individual key string.
 * 3. Within each key group, check for:
 *    - Same key + same scope → **error** (unreliable dispatch)
 *    - Same key + different builtin scopes → OK (scope stack handles priority)
 *    - Same key + one builtin / one custom scope → **warning** (ambiguous priority)
 *    - Same key + two custom scopes → **warning** (can't determine priority)
 *
 * @param actions - The registered actions to analyze.
 * @returns An array of collision warnings (empty when no issues found).
 */
export function detectCollisions(actions: Action[]): CollisionWarning[] {
  const warnings: CollisionWarning[] = []

  // Filter to actions that participate in keyboard routing
  const routed = actions.filter(
    (a): a is Action & { keys: string[]; scope: FocusScope } =>
      a.keys !== undefined &&
      a.keys.length > 0 &&
      a.scope !== undefined,
  )

  // Build key → entries map
  const keyMap = new Map<string, KeyGroupEntry[]>()
  for (const action of routed) {
    for (const k of action.keys) {
      const key = k.toLowerCase()
      let bucket = keyMap.get(key)
      if (!bucket) {
        bucket = []
        keyMap.set(key, bucket)
      }
      bucket.push({ action, scope: action.scope })
    }
  }

  // Analyze each key group for collisions
  for (const [key, entries] of keyMap) {
    if (entries.length < 2) continue

    // Compare every pair (n²) — expected small group sizes
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]
        const b = entries[j]

        // Same scope → error
        if (a.scope === b.scope) {
          warnings.push({
            key,
            scope1: a.scope,
            scope2: b.scope,
            action1Id: a.action.id,
            action2Id: b.action.id,
            severity: 'error',
            message: `Key "${key}" is registered by both "${a.action.id}" and "${b.action.id}" within the same scope "${a.scope}". This may cause unreliable dispatch.`,
          })
          continue
        }

        const aBuiltin = isBuiltinScope(a.scope)
        const bBuiltin = isBuiltinScope(b.scope)

        // Both builtins — OK (priority system handles it)
        if (aBuiltin && bBuiltin) continue

        // One builtin, one custom — warn
        if (aBuiltin !== bBuiltin) {
          const builtin = aBuiltin ? a : b
          const custom = aBuiltin ? b : a
          warnings.push({
            key,
            scope1: builtin.scope,
            scope2: custom.scope,
            action1Id: builtin.action.id,
            action2Id: custom.action.id,
            severity: 'warning',
            message: `Key "${key}" is registered in builtin scope "${builtin.scope}" (action "${builtin.action.id}") and custom scope "${custom.scope}" (action "${custom.action.id}"). Custom scopes have default priority; verify intended dispatch order.`,
          })
          continue
        }

        // Both custom scopes with unknown relative priority — warn
        warnings.push({
          key,
          scope1: a.scope,
          scope2: b.scope,
          action1Id: a.action.id,
          action2Id: b.action.id,
          severity: 'warning',
          message: `Key "${key}" is registered in custom scopes "${a.scope}" (action "${a.action.id}") and "${b.scope}" (action "${b.action.id}"). Relative priority cannot be determined; verify intended dispatch order.`,
        })
      }
    }
  }

  return warnings
}
