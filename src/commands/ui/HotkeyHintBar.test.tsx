import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React, { type ReactNode } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { ScopedActionRegistryProvider } from '../actions/ScopedActionRegistryProvider.js'
import { ActionRegistry } from '../actions/ActionRegistry.js'
import type { Action } from '../actions/ActionRegistry.js'
import { HotkeyHintBar } from './HotkeyHintBar.js'

function renderInContext(
  ui: ReactNode,
  registry: ActionRegistry,
) {
  return render(
    <ThemeProvider>
      <ScopedActionRegistryProvider registry={registry}>
        {ui}
      </ScopedActionRegistryProvider>
    </ThemeProvider>,
  )
}

function makeRegistry(actions: Action[]): ActionRegistry {
  const registry = new ActionRegistry()
  for (const action of actions) {
    registry.register(action)
  }
  return registry
}

describe('HotkeyHintBar', () => {
  it('renders active actions with key hints', () => {
    const registry = makeRegistry([
      {
        id: 'nav-back',
        label: 'Back',
        category: 'navigation',
        handler: () => {},
        keys: ['b'],
        scope: 'navigation',
      },
      {
        id: 'nav-forward',
        label: 'Forward',
        category: 'navigation',
        handler: () => {},
        keys: ['f'],
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[b] Back')
    expect(lastFrame()).toContain('[f] Forward')
  })

  it('falls back to shortcut when keys is not provided', () => {
    const registry = makeRegistry([
      {
        id: 'quit',
        label: 'Quit',
        category: 'system',
        handler: () => {},
        shortcut: 'q',
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[q] Quit')
  })

  it('uses keys[0] over shortcut when both are provided', () => {
    const registry = makeRegistry([
      {
        id: 'help',
        label: 'Help',
        category: 'system',
        handler: () => {},
        keys: ['?'],
        shortcut: 'h',
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[?] Help')
    expect(lastFrame()).not.toContain('[h] Help')
  })

  it('sorts actions by group then label', () => {
    const registry = makeRegistry([
      {
        id: 'a2',
        label: 'ZZZ',
        category: 'system',
        handler: () => {},
        keys: ['z'],
        group: 'B',
        scope: 'navigation',
      },
      {
        id: 'a1',
        label: 'AAA',
        category: 'system',
        handler: () => {},
        keys: ['a'],
        group: 'A',
        scope: 'navigation',
      },
      {
        id: 'a3',
        label: 'BBB',
        category: 'system',
        handler: () => {},
        keys: ['b'],
        group: 'A',
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    const output = lastFrame() ?? ''
    const idxA = output.indexOf('AAA')
    const idxB = output.indexOf('BBB')
    const idxZ = output.indexOf('ZZZ')
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxZ)
  })

  it('caps display at maxHints', () => {
    const actions = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      label: `Action ${i}`,
      category: 'system',
      handler: () => {},
      keys: [`${i}`],
      scope: 'navigation' as const,
    }))
    const registry = makeRegistry(actions)

    const { lastFrame } = renderInContext(
      <HotkeyHintBar maxHints={3} />,
      registry,
    )

    const output = lastFrame() ?? ''
    expect(output).toContain('Action 0')
    expect(output).toContain('Action 1')
    expect(output).toContain('Action 2')
    expect(output).not.toContain('Action 3')
  })

  it('returns null when no active actions', () => {
    const registry = new ActionRegistry()
    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('[')
    expect(frame.trim()).toBe('')
  })

  it('filters by scope when scope prop is provided', () => {
    const registry = makeRegistry([
      {
        id: 'nav-item',
        label: 'Navigate',
        category: 'navigation',
        handler: () => {},
        keys: ['n'],
        scope: 'navigation',
      },
      {
        id: 'list-item',
        label: 'Select',
        category: 'list',
        handler: () => {},
        keys: ['enter'],
        scope: 'list',
      },
    ])

    const { lastFrame } = renderInContext(
      <HotkeyHintBar scope="navigation" />,
      registry,
    )

    expect(lastFrame()).toContain('[n] Navigate')
    expect(lastFrame()).not.toContain('[enter] Select')
  })

  it('shows actions with no group alongside grouped actions', () => {
    const registry = makeRegistry([
      {
        id: 'no-group',
        label: 'Ungrouped',
        category: 'system',
        handler: () => {},
        keys: ['u'],
        scope: 'navigation',
      },
      {
        id: 'grouped',
        label: 'Grouped',
        category: 'system',
        handler: () => {},
        keys: ['g'],
        group: 'General',
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[g] Grouped')
    expect(lastFrame()).toContain('[u] Ungrouped')
  })

  it('returns empty key string when no keys or shortcut provided', () => {
    const registry = makeRegistry([
      {
        id: 'no-key',
        label: 'No Key',
        category: 'system',
        handler: () => {},
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[] No Key')
  })

  it('hides actions with visible: false', () => {
    const registry = makeRegistry([
      {
        id: 'visible',
        label: 'Visible',
        category: 'system',
        handler: () => {},
        keys: ['v'],
        visible: true,
        scope: 'navigation',
      },
      {
        id: 'hidden',
        label: 'Hidden',
        category: 'system',
        handler: () => {},
        keys: ['h'],
        visible: false,
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[v] Visible')
    expect(lastFrame()).not.toContain('[h] Hidden')
  })

  it('hides actions with enabled: false', () => {
    const registry = makeRegistry([
      {
        id: 'enabled',
        label: 'Enabled',
        category: 'system',
        handler: () => {},
        keys: ['e'],
        enabled: true,
        visible: true,
        scope: 'navigation',
      },
      {
        id: 'disabled',
        label: 'Disabled',
        category: 'system',
        handler: () => {},
        keys: ['d'],
        enabled: false,
        visible: true,
        scope: 'navigation',
      },
    ])

    const { lastFrame } = renderInContext(<HotkeyHintBar />, registry)

    expect(lastFrame()).toContain('[e] Enabled')
    expect(lastFrame()).not.toContain('[d] Disabled')
  })
})
