import type { Action } from '../../commands/actions/ActionRegistry.js'
import type { FocusScope } from '../../types.js'
import { getScopePriority } from '../../constants.js'

export interface Keybinding {
  keys: string
  scope: FocusScope
  handler: () => void
  description: string
}

/**
 * @deprecated Use `ActionRegistry` from `../../commands/actions/ActionRegistry.js` instead.
 * The `ActionRegistry` provides a unified action model with scope-aware keyboard
 * routing, visibility/enabled toggles, and footer integration.
 *
 * Existing code will continue to work. Use `keyboardRegistryToActions()` to
 * bridge your existing `KeyboardRegistry` to the new `Action` model.
 */
export class KeyboardRegistry {
  private bindings = new Map<string, Keybinding>()

  register(binding: Keybinding): void {
    const key = `${binding.scope}:${binding.keys}`
    if (this.bindings.has(key)) {
      throw new Error(
        `Keybinding "${binding.keys}" for scope "${binding.scope}" is already registered`,
      )
    }
    this.bindings.set(key, binding)
  }

  get(id: string): Keybinding | undefined {
    return this.bindings.get(id)
  }

  getForScope(scope: FocusScope): Keybinding[] {
    return Array.from(this.bindings.values()).filter(
      (b) => b.scope === scope,
    )
  }

  getAll(): Keybinding[] {
    return Array.from(this.bindings.values())
  }

  has(keys: string, scope: FocusScope): boolean {
    return this.bindings.has(`${scope}:${keys}`)
  }

  unregister(keys: string, scope: FocusScope): void {
    const key = `${scope}:${keys}`
    if (!this.bindings.has(key)) {
      throw new Error(
        `Keybinding "${keys}" for scope "${scope}" not found in registry`,
      )
    }
    this.bindings.delete(key)
  }

  getScopePriority(scope: FocusScope): number {
    return getScopePriority(scope)
  }

  getByPriority(): Keybinding[] {
    return this.getAll().sort(
      (a, b) => this.getScopePriority(a.scope) - this.getScopePriority(b.scope),
    )
  }
}

export function keyboardRegistryToActions(
  registry: KeyboardRegistry,
): Action[] {
  return registry.getAll().map((binding) => ({
    id: binding.description.toLowerCase().replace(/\s+/g, '-'),
    label: binding.description,
    description: binding.description,
    category: 'system' as const,
    handler: binding.handler,
    keys: [binding.keys],
    scope: binding.scope,
  }))
}
