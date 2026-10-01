import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import React, { useState, useEffect, type ReactNode } from 'react'
import {
  ScopedActionRegistryProvider,
  useScopedActionRegistry,
  useRegisterActions,
  useActiveActions,
} from './ScopedActionRegistryProvider.js'
import { ActionRegistry } from './ActionRegistry.js'

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <ScopedActionRegistryProvider>
      {children}
    </ScopedActionRegistryProvider>
  )
}

describe('ScopedActionRegistryProvider', () => {
  it('provides context to children', () => {
    function Consumer() {
      const ctx = useScopedActionRegistry()
      expect(ctx).toBeDefined()
      expect(typeof ctx.getVisibleActions).toBe('function')
      expect(typeof ctx.getActionsByScope).toBe('function')
      expect(typeof ctx.registerActions).toBe('function')
      return <Text>ok</Text>
    }

    const { lastFrame } = render(
      <ScopedActionRegistryProvider>
        <Consumer />
      </ScopedActionRegistryProvider>,
    )
    expect(lastFrame()).toBe('ok')
  })

  it('throws when used outside provider', () => {
    function Consumer() {
      try {
        useScopedActionRegistry()
        return <Text>no error</Text>
      } catch (e) {
        return <Text>{(e as Error).message}</Text>
      }
    }
    const { lastFrame } = render(<Consumer />)
    expect(lastFrame()).toContain('useScopedActionRegistry() must be used within a <ScopedActionRegistryProvider>')
  })

  it('accepts an existing ActionRegistry', () => {
    const existing = new ActionRegistry()
    existing.register({
      id: 'pre-registered',
      label: 'Pre',
      category: 'system',
      handler: () => {},
      scope: 'navigation',
    })

    function Consumer() {
      const ctx = useScopedActionRegistry()
      expect(ctx.getActionsByScope('navigation')).toHaveLength(1)
      return <Text>ok</Text>
    }

    const { lastFrame } = render(
      <ScopedActionRegistryProvider registry={existing}>
        <Consumer />
      </ScopedActionRegistryProvider>,
    )
    expect(lastFrame()).toBe('ok')
  })
})

describe('useRegisterActions', () => {
  it('registers actions on mount and unregisters on unmount', async () => {
    const snapshots: string[] = []

    function Child({ label }: { label: string }) {
      useRegisterActions([
        {
          id: `action-${label}`,
          label,
          category: 'system' as const,
          handler: () => {},
          scope: 'navigation' as const,
        },
      ])
      return <Text>{label}</Text>
    }

    function Consumer() {
      const [show, setShow] = useState(true)

      useEffect(() => {
        if (!show) return
        const id = setTimeout(() => setShow(false), 10)
        return () => clearTimeout(id)
      }, [show])

      return show ? (
        <Child label="test-action" />
      ) : (
        <Text>done</Text>
      )
    }

    function Spy() {
      const ctx = useScopedActionRegistry()
      useEffect(() => {
        const id = setInterval(() => {
          snapshots.push(
            ctx.getActionsByScope('navigation').map((a) => a.id).join(','),
          )
        }, 5)
        return () => clearInterval(id)
      }, [])
      return null
    }

    const { lastFrame } = render(
      <TestWrapper>
        <Spy />
        <Consumer />
      </TestWrapper>,
    )

    await delay(100)
    expect(lastFrame()).toBe('done')
    const lastSnapshot = snapshots[snapshots.length - 1]
    expect(lastSnapshot).toBe('')
  })
})

describe('useActiveActions', () => {
  it('returns only visible and enabled actions', async () => {
    function Consumer() {
      const actions = useActiveActions()
      const ids = actions.map((a) => a.id).sort()
      return <Text>{ids.join(',')}</Text>
    }

    function Setup() {
      useRegisterActions([
        {
          id: 'visible-enabled',
          label: 'VE',
          category: 'system',
          handler: () => {},
          visible: true,
          enabled: true,
          scope: 'navigation',
        },
        {
          id: 'hidden',
          label: 'Hidden',
          category: 'system',
          handler: () => {},
          visible: false,
          enabled: true,
          scope: 'navigation',
        },
        {
          id: 'disabled',
          label: 'Disabled',
          category: 'system',
          handler: () => {},
          visible: true,
          enabled: false,
          scope: 'navigation',
        },
      ])
      return <Consumer />
    }

    const { lastFrame } = render(
      <TestWrapper>
        <Setup />
      </TestWrapper>,
    )
    await delay(50)
    expect(lastFrame()).toBe('visible-enabled')
  })
})

describe('registerActions lifecycle', () => {
  it('registers multiple actions and returns cleanup', () => {
    const registry = new ActionRegistry()
    const ctx = {
      getVisibleActions: () => registry.getVisibleActions(),
      getActionsByScope: (scope: any) => registry.getActionsByScope(scope),
      registerActions: (actions: any[]) => {
        for (const a of actions) {
          if (!registry.has(a.id)) registry.register(a)
        }
        return () => {
          for (const a of actions) {
            if (registry.has(a.id)) registry.unregister(a.id)
          }
        }
      },
      isActionAvailable: (id: string) => registry.isActionAvailable(id),
    }

    const cleanup = ctx.registerActions([
      { id: 'a1', label: 'A1', category: 'system', handler: () => {}, scope: 'navigation' },
      { id: 'a2', label: 'A2', category: 'system', handler: () => {}, scope: 'navigation' },
    ])

    expect(registry.getAll()).toHaveLength(2)
    expect(ctx.getActionsByScope('navigation')).toHaveLength(2)

    cleanup()

    expect(registry.getAll()).toHaveLength(0)
    expect(ctx.getActionsByScope('navigation')).toHaveLength(0)
  })

  it('skips re-registration of duplicate action ids', () => {
    const registry = new ActionRegistry()
    const ctx = {
      getVisibleActions: () => registry.getVisibleActions(),
      getActionsByScope: (scope: any) => registry.getActionsByScope(scope),
      registerActions: (actions: any[]) => {
        for (const a of actions) {
          if (!registry.has(a.id)) registry.register(a)
        }
        return () => {
          for (const a of actions) {
            if (registry.has(a.id)) registry.unregister(a.id)
          }
        }
      },
      isActionAvailable: (id: string) => registry.isActionAvailable(id),
    }

    ctx.registerActions([
      { id: 'dup', label: 'First', category: 'system', handler: () => {} },
    ])
    expect(registry.getAll()).toHaveLength(1)

    ctx.registerActions([
      { id: 'dup', label: 'Second', category: 'system', handler: () => {} },
    ])
    expect(registry.getAll()).toHaveLength(1)
    expect(registry.get('dup')!.label).toBe('First')
  })
})

describe('keyboardRegistryToActions bridge', () => {
  it('converts KeyboardRegistry bindings to Actions', async () => {
    const { KeyboardRegistry, keyboardRegistryToActions } = await import(
      '../../interaction/keyboard/KeyboardRegistry.js'
    )
    const kb = new KeyboardRegistry()
    kb.register({
      keys: 'b',
      scope: 'navigation',
      handler: () => {},
      description: 'Go Back',
    })
    kb.register({
      keys: 'enter',
      scope: 'list',
      handler: () => {},
      description: 'Select Item',
    })

    const actions = keyboardRegistryToActions(kb)
    expect(actions).toHaveLength(2)
    expect(actions[0].id).toBe('go-back')
    expect(actions[0].keys).toEqual(['b'])
    expect(actions[0].scope).toBe('navigation')
    expect(actions[1].id).toBe('select-item')
    expect(actions[1].keys).toEqual(['enter'])
    expect(actions[1].scope).toBe('list')
  })
})
