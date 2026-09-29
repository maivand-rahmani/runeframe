import { describe, it, expect } from 'vitest'
import { detectCollisions } from './CollisionDetector.js'
import type { Action } from './ActionRegistry.js'

function action(
  id: string,
  keys: string[],
  scope?: string,
  overrides: Partial<Action> = {},
): Action {
  return {
    id,
    label: id,
    category: 'system',
    handler: () => {},
    keys,
    scope: scope as Action['scope'],
    ...overrides,
  }
}

describe('detectCollisions', () => {
  it('returns empty array for no actions', () => {
    expect(detectCollisions([])).toEqual([])
  })

  it('returns empty for actions without keys', () => {
    const actions: Action[] = [
      { id: 'a', label: 'A', category: 'sys', handler: () => {} },
    ]
    expect(detectCollisions(actions)).toEqual([])
  })

  it('returns empty for actions with keys but no scope', () => {
    const actions: Action[] = [
      { id: 'a', label: 'A', category: 'sys', handler: () => {}, keys: ['b'] },
    ]
    expect(detectCollisions(actions)).toEqual([])
  })

  it('returns empty for single action with key and scope', () => {
    const actions = [action('nav-home', ['b'], 'navigation')]
    expect(detectCollisions(actions)).toEqual([])
  })

  it('returns empty for same key in different builtin scopes', () => {
    const actions = [
      action('nav-home', ['escape'], 'navigation'),
      action('modal-close', ['escape'], 'modal'),
    ]
    expect(detectCollisions(actions)).toEqual([])
  })

  it('detects error when same key registered in same scope', () => {
    const actions = [
      action('nav-home', ['b'], 'navigation'),
      action('nav-dashboard', ['b'], 'navigation'),
    ]
    const result = detectCollisions(actions)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      key: 'b',
      severity: 'error',
      scope1: 'navigation',
      scope2: 'navigation',
    })
  })

  it('detects multiple collisions for same key across multiple actions', () => {
    const actions = [
      action('a1', ['enter'], 'list'),
      action('a2', ['enter'], 'list'),
      action('a3', ['enter'], 'list'),
    ]
    const result = detectCollisions(actions)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.every((w) => w.severity === 'error')).toBe(true)
    expect(result.every((w) => w.key === 'enter')).toBe(true)
  })

  it('warns when builtin and custom scope share a key', () => {
    const actions = [
      action('nav-action', ['x'], 'navigation'),
      action('custom-action', ['x'], 'my-custom-scope'),
    ]
    const result = detectCollisions(actions)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      key: 'x',
      severity: 'warning',
    })
    expect(result[0].message).toContain('navigation')
    expect(result[0].message).toContain('my-custom-scope')
  })

  it('warns when two custom scopes share a key', () => {
    const actions = [
      action('custom-a', ['y'], 'scope-alpha'),
      action('custom-b', ['y'], 'scope-beta'),
    ]
    const result = detectCollisions(actions)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      key: 'y',
      severity: 'warning',
    })
  })

  it('handles actions with multiple keys correctly', () => {
    const actions = [
      action('a', ['b', 'c'], 'navigation'),
      action('b', ['c', 'd'], 'navigation'),
    ]
    const result = detectCollisions(actions)
    const collisionsForKeyC = result.filter((w) => w.key === 'c')
    expect(collisionsForKeyC).toHaveLength(1)
    expect(collisionsForKeyC[0].severity).toBe('error')
  })

  it('handles mixed builtin and custom scopes with multiple keys', () => {
    const actions = [
      action('editor-save', ['ctrl+s'], 'textinput'),
      action('custom-save', ['ctrl+s'], 'editor-custom'),
      action('nav-up', ['k', 'up'], 'navigation'),
      action('list-up', ['k', 'up'], 'list'),
    ]
    const result = detectCollisions(actions)

    const ctrlS = result.filter((w) => w.key === 'ctrl+s')
    expect(ctrlS).toHaveLength(1)
    expect(ctrlS[0].severity).toBe('warning')

    const k = result.filter((w) => w.key === 'k')
    expect(k).toHaveLength(0)

    const up = result.filter((w) => w.key === 'up')
    expect(up).toHaveLength(0)
  })

  it('includes human-readable message in each warning', () => {
    const actions = [
      action('dup-a', ['z'], 'command'),
      action('dup-b', ['z'], 'command'),
    ]
    const result = detectCollisions(actions)
    expect(result).toHaveLength(1)
    expect(result[0].message).toBeTruthy()
    expect(typeof result[0].message).toBe('string')
    expect(result[0].message.length).toBeGreaterThan(10)
  })

  it('is case-insensitive for key matching', () => {
    const actions = [
      action('a', ['Ctrl+P'], 'navigation'),
      action('b', ['ctrl+p'], 'navigation'),
    ]
    const result = detectCollisions(actions)
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('error')
  })

  it('returns empty for actions with empty keys arrays', () => {
    const actions = [
      action('a', [], 'navigation'),
      action('b', [], 'navigation'),
    ]
    expect(detectCollisions(actions)).toEqual([])
  })
})
