import { describe, it, expect, beforeEach } from 'vitest'
import { KeyboardRegistry } from './KeyboardRegistry.js'

describe('KeyboardRegistry', () => {
  let registry: KeyboardRegistry

  beforeEach(() => {
    registry = new KeyboardRegistry()
    registry.register({
      keys: 'q',
      scope: 'navigation',
      handler: () => {},
      description: 'Quit application',
    })
    registry.register({
      keys: 'b',
      scope: 'navigation',
      handler: () => {},
      description: 'Go to dashboard',
    })
    registry.register({
      keys: 'escape',
      scope: 'modal',
      handler: () => {},
      description: 'Close modal',
    })
    registry.register({
      keys: 'return',
      scope: 'modal',
      handler: () => {},
      description: 'Confirm',
    })
    registry.register({
      keys: 'upArrow',
      scope: 'list',
      handler: () => {},
      description: 'Previous item',
    })
    registry.register({
      keys: 'downArrow',
      scope: 'list',
      handler: () => {},
      description: 'Next item',
    })
  })

  it('registers a keybinding', () => {
    expect(registry.has('q', 'navigation')).toBe(true)
  })

  it('gets bindings by scope', () => {
    const navBindings = registry.getForScope('navigation')
    expect(navBindings).toHaveLength(2)
    expect(navBindings.map((b) => b.keys)).toContain('q')
    expect(navBindings.map((b) => b.keys)).toContain('b')
  })

  it('gets all bindings', () => {
    expect(registry.getAll()).toHaveLength(6)
  })

  it('returns empty for scope with no bindings', () => {
    expect(registry.getForScope('textinput')).toHaveLength(0)
  })

  it('throws on duplicate registration', () => {
    expect(() =>
      registry.register({
        keys: 'q',
        scope: 'navigation',
        handler: () => {},
        description: 'Duplicate',
      }),
    ).toThrow('Keybinding "q" for scope "navigation" is already registered')
  })

  it('allows same key in different scopes', () => {
    registry.register({
      keys: 'q',
      scope: 'command',
      handler: () => {},
      description: 'Quit in command scope',
    })
    expect(registry.has('q', 'navigation')).toBe(true)
    expect(registry.has('q', 'command')).toBe(true)
  })

  it('unregisters a keybinding', () => {
    registry.unregister('q', 'navigation')
    expect(registry.has('q', 'navigation')).toBe(false)
    expect(registry.getAll()).toHaveLength(5)
  })

  it('throws on unregistering unknown binding', () => {
    expect(() => registry.unregister('nope', 'navigation')).toThrow(
      'Keybinding "nope" for scope "navigation" not found in registry',
    )
  })

  it('sorts by priority (modal first)', () => {
    const sorted = registry.getByPriority()
    expect(sorted[0].scope).toBe('modal')
    expect(sorted[sorted.length - 1].scope).toBe('navigation')
  })

  it('returns description for a binding', () => {
    const bindings = registry.getForScope('navigation')
    const quit = bindings.find((b) => b.keys === 'q')
    expect(quit?.description).toBe('Quit application')
  })

  it('get returns binding by composite id', () => {
    const binding = registry.get('navigation:q')
    expect(binding).toBeDefined()
    expect(binding!.keys).toBe('q')
  })
})
