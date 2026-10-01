import { describe, it, expect, beforeEach } from 'vitest'
import { ActionRegistry } from './ActionRegistry.js'

function createTestRegistry() {
  const r = new ActionRegistry()
  r.register({
    id: 'start',
    label: 'Start Daily Plan',
    description: 'Begin your daily learning session',
    category: 'learning',
    handler: () => {},
  })
  r.register({
    id: 'speak',
    label: 'Speaking Practice',
    description: 'Practice speaking with AI feedback',
    category: 'learning',
    handler: () => {},
  })
  r.register({
    id: 'write',
    label: 'Writing Practice',
    description: 'Practice writing with AI corrections',
    category: 'learning',
    handler: () => {},
  })
  r.register({
    id: 'stats',
    label: 'View Statistics',
    description: 'Show your progress and statistics',
    category: 'system',
    handler: () => {},
    shortcut: 't',
  })
  r.register({
    id: 'config',
    label: 'Configuration',
    description: 'Configure app settings',
    category: 'system',
    handler: () => {},
    shortcut: 'c',
  })
  r.register({
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Go to the main dashboard',
    category: 'navigation',
    handler: () => {},
    shortcut: 'b',
  })
  return r
}

describe('ActionRegistry', () => {
  let registry: ActionRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('registers and retrieves an action', () => {
    const action = registry.get('start')
    expect(action).toBeDefined()
    expect(action!.label).toBe('Start Daily Plan')
  })

  it('returns undefined for unknown action', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('returns all registered actions', () => {
    expect(registry.getAll()).toHaveLength(6)
  })

  it('has returns true for registered action', () => {
    expect(registry.has('speak')).toBe(true)
  })

  it('has returns false for unknown action', () => {
    expect(registry.has('nope')).toBe(false)
  })

  it('throws on duplicate registration', () => {
    expect(() =>
      registry.register({
        id: 'start',
        label: 'Duplicate',
        category: 'other',
        handler: () => {},
      }),
    ).toThrow('Action "start" is already registered')
  })

  it('unregisters an action', () => {
    registry.unregister('config')
    expect(registry.has('config')).toBe(false)
    expect(registry.getAll()).toHaveLength(5)
  })

  it('throws on unregistering unknown action', () => {
    expect(() => registry.unregister('nope')).toThrow(
      'Action "nope" not found in registry',
    )
  })

  it('searches by label (exact match highest score)', () => {
    const results = registry.search('Speaking Practice')
    expect(results[0].action.id).toBe('speak')
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('searches by label (partial match)', () => {
    const results = registry.search('speak')
    expect(results).toHaveLength(1)
    expect(results[0].action.id).toBe('speak')
  })

  it('searches by id', () => {
    const results = registry.search('config')
    expect(results).toHaveLength(1)
    expect(results[0].action.id).toBe('config')
  })

  it('searches by description', () => {
    const results = registry.search('statistics')
    expect(results).toHaveLength(1)
    expect(results[0].action.id).toBe('stats')
  })

  it('returns all actions for empty query', () => {
    const results = registry.search('')
    expect(results).toHaveLength(6)
  })

  it('returns all actions for whitespace query', () => {
    const results = registry.search('   ')
    expect(results).toHaveLength(6)
  })

  it('returns empty for unmatched query', () => {
    const results = registry.search('zzzzz')
    expect(results).toHaveLength(0)
  })

  it('sorts results by score descending', () => {
    const results = registry.search('st')
    expect(results.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('fuzzy matches characters in order', () => {
    const results = registry.search('spk')
    expect(results).toHaveLength(1)
    expect(results[0].action.id).toBe('speak')
  })

  it('does not match out-of-order characters', () => {
    const results = registry.search('ksp')
    const speak = results.find((r) => r.action.id === 'speak')
    expect(speak).toBeUndefined()
  })
})

describe('ActionRegistry — scope-aware extensions', () => {
  let registry: ActionRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('legacy actions without scope/visible/enabled still work', () => {
    const start = registry.get('start')
    expect(start).toBeDefined()
    expect(start!.scope).toBeUndefined()
    expect(start!.enabled).toBeUndefined()
    expect(start!.visible).toBeUndefined()
    expect(start!.keys).toBeUndefined()
    expect(start!.group).toBeUndefined()
    expect(registry.has('start')).toBe(true)
  })

  it('registers and retrieves action with new fields', () => {
    registry.register({
      id: 'debug',
      label: 'Debug Mode',
      description: 'Toggle debug mode',
      category: 'system',
      handler: () => {},
      keys: ['ctrl+d'],
      scope: 'command',
      enabled: () => true,
      visible: true,
      group: 'developer',
    })
    const action = registry.get('debug')
    expect(action).toBeDefined()
    expect(action!.keys).toEqual(['ctrl+d'])
    expect(action!.scope).toBe('command')
    expect(action!.group).toBe('developer')
    expect(typeof action!.enabled).toBe('function')
    expect(action!.visible).toBe(true)
  })

  it('getActionsByScope filters by scope', () => {
    registry.register({
      id: 'nav-home',
      label: 'Home',
      category: 'navigation',
      handler: () => {},
      scope: 'navigation',
    })
    registry.register({
      id: 'nav-back',
      label: 'Back',
      category: 'navigation',
      handler: () => {},
      scope: 'navigation',
    })
    registry.register({
      id: 'cmd-search',
      label: 'Search',
      category: 'system',
      handler: () => {},
      scope: 'command',
    })

    const nav = registry.getActionsByScope('navigation')
    expect(nav).toHaveLength(2)
    expect(nav.map((a) => a.id).sort()).toEqual(['nav-back', 'nav-home'])

    const cmd = registry.getActionsByScope('command')
    expect(cmd).toHaveLength(1)
    expect(cmd[0].id).toBe('cmd-search')
  })

  it('getActionsByScope returns empty for unmatched scope', () => {
    expect(registry.getActionsByScope('modal')).toEqual([])
  })

  it('getVisibleActions returns actions with visible=true (default)', () => {
    expect(registry.getVisibleActions()).toHaveLength(6)

    registry.register({
      id: 'hidden-action',
      label: 'Hidden',
      category: 'system',
      handler: () => {},
      visible: false,
    })
    expect(registry.getVisibleActions()).toHaveLength(6)
    expect(registry.get('hidden-action')).toBeDefined()
  })

  it('getVisibleActions respects dynamic visible function', () => {
    let flag = true
    registry.register({
      id: 'conditional',
      label: 'Conditional',
      category: 'system',
      handler: () => {},
      visible: () => flag,
    })
    expect(registry.getVisibleActions()).toHaveLength(7)

    flag = false
    expect(registry.getVisibleActions()).toHaveLength(6)
  })

  it('isActionAvailable returns true for legacy action without enabled', () => {
    expect(registry.isActionAvailable('speak')).toBe(true)
  })

  it('isActionAvailable returns false for unknown action', () => {
    expect(registry.isActionAvailable('nonexistent')).toBe(false)
  })

  it('isActionAvailable respects dynamic enabled toggle', () => {
    let canRun = true
    registry.register({
      id: 'gated',
      label: 'Gated Action',
      category: 'system',
      handler: () => {},
      enabled: () => canRun,
    })

    expect(registry.isActionAvailable('gated')).toBe(true)
    canRun = false
    expect(registry.isActionAvailable('gated')).toBe(false)
  })

  it('isActionAvailable respects static enabled: false', () => {
    registry.register({
      id: 'disabled-action',
      label: 'Disabled',
      category: 'system',
      handler: () => {},
      enabled: false,
    })
    expect(registry.has('disabled-action')).toBe(true)
    expect(registry.isActionAvailable('disabled-action')).toBe(false)
  })
})
