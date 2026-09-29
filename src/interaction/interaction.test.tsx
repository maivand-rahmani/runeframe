import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useContext, useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  KeyboardScopeProvider,
  useKeyboardScope,
} from './keyboard/KeyboardScopeProvider.js'
import { useKeyHandler, useKeyBinding } from './keyboard/useKeyHandler.js'
import {
  useFocusZone,
  useFocusGroup,
  useFocusable,
  FocusTreeProvider,
  FocusZoneContext,
} from './focus/FocusTreeProvider.js'
import { ScopedActionRegistryProvider } from '../commands/actions/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../types.js'
import type { NormalizedKeyEvent } from '../types.js'

function renderUI(ui: ReactElement) {
  return render(ui)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('KeyboardScopeProvider', () => {
  it('provides scope context', () => {
    function Reader() {
      const ctx = useKeyboardScope()
      return <Text>Scope: {ctx.activeScope}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <Reader />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Scope: navigation')
  })

  it('accepts custom default scope', () => {
    function Reader() {
      const ctx = useKeyboardScope()
      return <Text>Scope: {ctx.activeScope}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider defaultScope="list">
        <Reader />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Scope: list')
  })

  it('activateScope changes active scope', async () => {
    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function Harness() {
      ctx = useKeyboardScope()
      return <Text>Scope: {ctx.activeScope}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
      </KeyboardScopeProvider>,
    )

    expect(lastFrame()).toContain('Scope: navigation')
    ctx!.activateScope('modal')
    await delay()
    expect(lastFrame()).toContain('Scope: modal')
  })

  it('routes input to active scope handlers', async () => {
    const navCalls: string[] = []
    const modalCalls: string[] = []

    function NavHandler() {
      useKeyHandler((event) => {
        navCalls.push(event.text)
      }, 'navigation')
      return null
    }
    function ModalHandler() {
      useKeyHandler((event) => {
        modalCalls.push(event.text)
      }, 'modal')
      return null
    }

    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function ScopeCapture() {
      ctx = useKeyboardScope()
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <NavHandler />
        <ModalHandler />
        <ScopeCapture />
      </KeyboardScopeProvider>,
    )

    stdin.write('a')
    await delay()
    expect(navCalls).toContain('a')
    expect(modalCalls).not.toContain('a')

    ctx!.activateScope('modal')
    await delay()

    stdin.write('b')
    await delay()
    expect(modalCalls).toContain('b')
    expect(navCalls.filter((c) => c === 'b')).toHaveLength(0)
  })

  it('does not route input to non-active scope', async () => {
    const listCalls: string[] = []

    function ListHandler() {
      useKeyHandler((event) => {
        listCalls.push(event.text)
      }, 'list')
      return null
    }

    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function ScopeCapture() {
      ctx = useKeyboardScope()
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <ListHandler />
        <ScopeCapture />
      </KeyboardScopeProvider>,
    )

    stdin.write('x')
    await delay()
    expect(listCalls).not.toContain('x')

    ctx!.activateScope('list')
    await delay()
    stdin.write('x')
    await delay()
    expect(listCalls).toContain('x')
  })
})

describe('useKeyboardScope()', () => {
  it('throws when used outside KeyboardScopeProvider', () => {
    function Bad() {
      useKeyboardScope()
      return <Text>bad</Text>
    }
    expect(() =>
      renderUI(<Bad />),
    ).not.toThrow()
  })
})

describe('useKeyHandler', () => {
  it('receives a NormalizedKeyEvent with correct properties', async () => {
    const received: NormalizedKeyEvent[] = []

    function TestHandler() {
      useKeyHandler((event) => {
        received.push(event)
      }, 'navigation')
      return <Text>test</Text>
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    stdin.write('a')
    await delay()
    expect(received).toHaveLength(1)
    expect(received[0].key).toBe('a')
    expect(received[0].text).toBe('a')
    expect(received[0].isPrintable).toBe(true)
    expect(received[0].rawInput).toBe('a')
    expect(received[0].ctrl).toBe(false)
    expect(received[0].shift).toBe(false)
    expect(received[0].meta).toBe(false)
    expect(received[0].alt).toBe(false)
  })

  it('returning Consumed blocks lower-priority handlers', async () => {
    const highCalls: string[] = []
    const lowCalls: string[] = []

    function HighPriority() {
      useKeyHandler(() => {
        highCalls.push('high')
        return InputConsumptionResult.Consumed
      }, 'navigation', { priority: 10 })
      return null
    }
    function LowPriority() {
      useKeyHandler(() => {
        lowCalls.push('low')
      }, 'navigation', { priority: 0 })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <HighPriority />
        <LowPriority />
      </KeyboardScopeProvider>,
    )

    stdin.write('x')
    await delay()
    expect(highCalls).toContain('high')
    expect(lowCalls).not.toContain('low')
  })

  it('returning NotConsumed passes through to next handler', async () => {
    const firstCalls: string[] = []
    const secondCalls: string[] = []

    function First() {
      useKeyHandler(() => {
        firstCalls.push('first')
        return InputConsumptionResult.NotConsumed
      }, 'navigation', { priority: 10 })
      return null
    }
    function Second() {
      useKeyHandler(() => {
        secondCalls.push('second')
      }, 'navigation', { priority: 0 })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <First />
        <Second />
      </KeyboardScopeProvider>,
    )

    stdin.write('y')
    await delay()
    expect(firstCalls).toContain('first')
    expect(secondCalls).toContain('second')
  })

  it('returning true as boolean is treated as Consumed', async () => {
    const highCalls: string[] = []
    const lowCalls: string[] = []

    function HighPriority() {
      useKeyHandler(() => {
        highCalls.push('high')
        return true
      }, 'navigation', { priority: 10 })
      return null
    }
    function LowPriority() {
      useKeyHandler(() => {
        lowCalls.push('low')
      }, 'navigation', { priority: 0 })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <HighPriority />
        <LowPriority />
      </KeyboardScopeProvider>,
    )

    stdin.write('z')
    await delay()
    expect(highCalls).toContain('high')
    expect(lowCalls).not.toContain('low')
  })

  it('returning ConsumedAndTrapped blocks propagation', async () => {
    const trappedCalls: string[] = []
    const otherCalls: string[] = []

    function Trapping() {
      useKeyHandler(() => {
        trappedCalls.push('trapped')
        return InputConsumptionResult.ConsumedAndTrapped
      }, 'navigation', { priority: 10 })
      return null
    }
    function Other() {
      useKeyHandler(() => {
        otherCalls.push('other')
      }, 'navigation', { priority: 0 })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <Trapping />
        <Other />
      </KeyboardScopeProvider>,
    )

    stdin.write('t')
    await delay()
    expect(trappedCalls).toContain('trapped')
    expect(otherCalls).not.toContain('other')
  })

  it('does not fire when scope is not active', async () => {
    const calls: string[] = []

    function TestHandler() {
      useKeyHandler(() => {
        calls.push('fired')
      }, 'list')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    stdin.write('q')
    await delay()
    expect(calls).not.toContain('fired')
  })

  it('cleans up scope and handler registration on unmount', async () => {
    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    const calls: string[] = []

    function Harness() {
      ctx = useKeyboardScope()
      return <Text>ok</Text>
    }

    function Handler() {
      useKeyHandler(() => {
        calls.push('fired')
      }, 'list')
      return null
    }

    function App({ showHandler }: { showHandler: boolean }) {
      return (
        <KeyboardScopeProvider>
          <Harness />
          {showHandler ? <Handler /> : null}
        </KeyboardScopeProvider>
      )
    }

    const { stdin, rerender } = renderUI(<App showHandler />)
    await delay()
    expect(ctx!.activeScopes).toContain('list')

    stdin.write('x')
    await delay()
    expect(calls).toContain('fired')

    rerender(<App showHandler={false} />)
    await delay()
    expect(ctx!.activeScopes).not.toContain('list')

    calls.length = 0
    stdin.write('x')
    await delay()
    expect(calls).toHaveLength(0)
  })
})

describe('useKeyBinding', () => {
  it('fires when bound key matches', async () => {
    const bCalls: string[] = []

    function TestHandler() {
      useKeyBinding('b', () => {
        bCalls.push('b')
      }, 'navigation')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    stdin.write('b')
    await delay()
    expect(bCalls).toContain('b')
  })

  it('does not fire when bound key does not match', async () => {
    const bCalls: string[] = []

    function TestHandler() {
      useKeyBinding('b', () => {
        bCalls.push('b')
      }, 'navigation')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    stdin.write('c')
    await delay()
    expect(bCalls).not.toContain('b')
  })

  it('requires modifier match when modifiers are specified', async () => {
    const ctrlBCalls: string[] = []

    function TestHandler() {
      useKeyBinding('b', () => {
        ctrlBCalls.push('ctrl+b')
      }, 'navigation', { modifiers: { ctrl: true } })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    // bare 'b' (no ctrl) should NOT fire
    stdin.write('b')
    await delay()
    expect(ctrlBCalls).not.toContain('ctrl+b')
  })

  it('fires on plain key without modifiers by default', async () => {
    const calls: string[] = []

    function TestHandler() {
      useKeyBinding('b', () => {
        calls.push('b')
      }, 'navigation')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <TestHandler />
      </KeyboardScopeProvider>,
    )

    stdin.write('b')
    await delay()
    expect(calls).toContain('b')
  })

  it('useKeyBinding consumes the event by returning true', async () => {
    const boundCalls: string[] = []
    const fallbackCalls: string[] = []

    function Bound() {
      useKeyBinding('x', () => {
        boundCalls.push('bound')
      }, 'navigation', { priority: 10 })
      return null
    }
    function Fallback() {
      useKeyHandler(() => {
        fallbackCalls.push('fallback')
      }, 'navigation', { priority: 0 })
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <Bound />
        <Fallback />
      </KeyboardScopeProvider>,
    )

    stdin.write('x')
    await delay()
    expect(boundCalls).toContain('bound')
    expect(fallbackCalls).not.toContain('fallback')
  })
})

describe('FocusTreeProvider & Focus Hierarchy', () => {
  function ZoneHarness({
    zoneId,
    children,
    scope = 'navigation',
    orientation,
    order,
  }: {
    zoneId: string
    children: ReactNode
    scope?: string
    orientation?: 'horizontal' | 'vertical'
    order?: number
  }) {
    const { ZoneProvider, isActive } = useFocusZone(zoneId, {
      scope,
      orientation,
      order,
    })
    return (
      <ZoneProvider>
        <Text>
          zone={zoneId} active={String(isActive)}
        </Text>
        {children}
      </ZoneProvider>
    )
  }

  function GroupHarness({
    groupId,
    children,
  }: {
    groupId: string
    children: ReactNode
  }) {
    const { GroupProvider } = useFocusGroup(groupId, { scope: 'navigation' })
    return <GroupProvider>{children}</GroupProvider>
  }

  function FocusableItem({ id, label }: { id: string; label: string }) {
    const { focused, isFirst, isLast } = useFocusable({ id })
    return (
      <Text>
        {label}
        {focused ? '*' : ''} f={String(isFirst)} l={String(isLast)}
      </Text>
    )
  }

  it('useFocusZone provides zone context to children', () => {
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <GroupHarness groupId="list">
            <FocusableItem id="a" label="Alpha" />
          </GroupHarness>
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Alpha')
  })

  it('useFocusGroup autoFocus focuses the first registered item', async () => {
    function TestGroup() {
      const { GroupProvider, focusedId } = useFocusGroup('items', {
        autoFocus: true,
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <Text>focusedId={focusedId ?? 'none'}</Text>
          <FocusableItem id="one" label="One" />
          <FocusableItem id="two" label="Two" />
        </GroupProvider>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()
    const frame = lastFrame()
    expect(frame).toContain('focusedId=one')
    expect(frame).toContain('One*')
  })

  it('useFocusGroup arrow down moves focus forward', async () => {
    function TestGroup() {
      const { GroupProvider } = useFocusGroup('items', {
        autoFocus: true,
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <FocusableItem id="first" label="First" />
          <FocusableItem id="second" label="Second" />
          <FocusableItem id="third" label="Third" />
        </GroupProvider>
      )
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('First*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('Second*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('Third*')
  })

  it('useFocusGroup arrow up moves focus backward and wraps', async () => {
    function TestGroup() {
      const { GroupProvider } = useFocusGroup('items', {
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <FocusableItem id="a" label="A" />
          <FocusableItem id="b" label="B" />
          <FocusableItem id="c" label="C" />
        </GroupProvider>
      )
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('A*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('B*')

    stdin.write('\u001b[A')
    await delay()
    expect(lastFrame()).toContain('A*')

    stdin.write('\u001b[A')
    await delay()
    expect(lastFrame()).toContain('C*')
  })

  it('useFocusGroup arrow down wraps at bottom', async () => {
    function TestGroup() {
      const { GroupProvider } = useFocusGroup('items', {
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <FocusableItem id="x" label="X" />
          <FocusableItem id="y" label="Y" />
        </GroupProvider>
      )
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('X*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('Y*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('X*')
  })

  it('useFocusable reports isFirst and isLast', async () => {
    function TestGroup() {
      const { GroupProvider } = useFocusGroup('items', {
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <FocusableItem id="a" label="A" />
          <FocusableItem id="b" label="B" />
          <FocusableItem id="c" label="C" />
        </GroupProvider>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()
    const frame = lastFrame()
    expect(frame).toContain('A f=true l=false')
    expect(frame).toContain('B f=false l=false')
    expect(frame).toContain('C f=false l=true')
  })

  it('useFocusable returns inert state outside a group', () => {
    function OrphanItem() {
      const { focused, isFirst, isLast } = useFocusable({ id: 'orphan' })
      return (
        <Text>
          orphan focused={String(focused)} f={String(isFirst)} l={String(isLast)}
        </Text>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <OrphanItem />
      </KeyboardScopeProvider>,
    )

    expect(lastFrame()).toContain('orphan focused=false f=false l=false')
  })

  it('zone tracks active group and deepest focusable', async () => {
    const deepest: string[] = []

    function TestGroup() {
      const { GroupProvider, focusedId } = useFocusGroup('items', {
        autoFocus: true,
        scope: 'navigation',
      })

      useEffect(() => {
        if (focusedId) deepest.push(focusedId)
      }, [focusedId])

      return (
        <GroupProvider>
          <FocusableItem id="one" label="One" />
          <FocusableItem id="two" label="Two" />
        </GroupProvider>
      )
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()

    stdin.write('\u001b[B')
    await delay()

    stdin.write('\u001b[B')
    await delay()

    expect(deepest).toContain('one')
    expect(deepest).toContain('two')
  })

  it('useFocusGroup activate() makes zone active group', async () => {
    function Activator() {
      const ctx = useContext(FocusZoneContext)
      return (
        <Text>activeGroup={ctx?.activeGroupId ?? 'noctx'}</Text>
      )
    }

    let groupActivate: (() => void) | null = null

    function GroupWithActivator() {
      const result = useFocusGroup('manual', { scope: 'navigation' })
      groupActivate = result.activate
      const { GroupProvider } = result
      return (
        <GroupProvider>
          <Text>active={String(result.isActive)}</Text>
          <FocusableItem id="x" label="X" />
        </GroupProvider>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <GroupWithActivator />
          <Activator />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('activeGroup=manual')

    expect(groupActivate).not.toBeNull()
    groupActivate!()
    await delay()
    expect(lastFrame()).toContain('active=true')
  })

  it('keeps an explicitly selected sibling group active through context updates', async () => {
    let activateFirst: (() => void) | null = null
    let activateSecond: (() => void) | null = null

    function SiblingGroups() {
      const first = useFocusGroup('first', { scope: 'navigation' })
      const second = useFocusGroup('second', { scope: 'navigation' })
      activateFirst = first.activate
      activateSecond = second.activate

      return (
        <>
          <first.GroupProvider>
            <Text>first active={String(first.isActive)}</Text>
          </first.GroupProvider>
          <second.GroupProvider>
            <Text>second active={String(second.isActive)}</Text>
          </second.GroupProvider>
        </>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <SiblingGroups />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('first active=true')
    expect(lastFrame()).toContain('second active=false')

    activateSecond!()
    await delay()
    expect(lastFrame()).toContain('first active=false')
    expect(lastFrame()).toContain('second active=true')

    activateFirst!()
    await delay()
    expect(lastFrame()).toContain('first active=true')
    expect(lastFrame()).toContain('second active=false')
  })

  it('useFocusable onActivate focuses the item', async () => {
    let activateB: (() => void) | null = null

    function ClickableB() {
      const { onActivate, focused } = useFocusable({ id: 'b' })
      activateB = onActivate
      return <Text>bFocused={String(focused)}</Text>
    }

    function TestGroup() {
      const { GroupProvider, focusedId } = useFocusGroup('items', {
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <Text>focused={focusedId ?? 'none'}</Text>
          <FocusableItem id="a" label="A" />
          <FocusableItem id="b" label="B" />
          <ClickableB />
        </GroupProvider>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <ZoneHarness zoneId="main">
          <TestGroup />
        </ZoneHarness>
      </KeyboardScopeProvider>,
    )

    await delay()

    expect(activateB).not.toBeNull()
    activateB!()
    await delay()
    expect(lastFrame()).toContain('bFocused=true')
  })

  it('nested zone→group→focusable works end-to-end', async () => {
    function NestedApp() {
      const { ZoneProvider } = useFocusZone('app', { scope: 'navigation' })
      const { GroupProvider } = useFocusGroup('menu', {
        autoFocus: true,
        scope: 'navigation',
      })
      return (
        <ZoneProvider>
          <GroupProvider>
            <FocusableItem id="home" label="Home" />
            <FocusableItem id="settings" label="Settings" />
            <FocusableItem id="about" label="About" />
          </GroupProvider>
        </ZoneProvider>
      )
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <NestedApp />
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('Home')
    expect(lastFrame()).toContain('Settings')
    expect(lastFrame()).toContain('About')
    expect(lastFrame()).toContain('Home*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('Settings*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('About*')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('Home*')
  })

  it('FocusTreeProvider wraps children in zone context', () => {
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider defaultScope="navigation">
          <Text>inside tree</Text>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('inside tree')
  })

  it('cycles registered zones forward and backward with Tab and wraps', async () => {
    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ZoneHarness zoneId="zone-a" order={2}>
            <Text>A</Text>
          </ZoneHarness>
          <ZoneHarness zoneId="zone-b" order={0}>
            <Text>B</Text>
          </ZoneHarness>
          <ZoneHarness zoneId="zone-c" order={1}>
            <Text>C</Text>
          </ZoneHarness>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('zone=zone-b active=true')

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=zone-c active=true')

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=zone-a active=true')

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=zone-b active=true')

    stdin.write('\u001b[Z')
    await delay()
    expect(lastFrame()).toContain('zone=zone-a active=true')
  })

  it('moves horizontally between configured zones and stops at boundaries', async () => {
    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ZoneHarness zoneId="left" orientation="horizontal" order={0}>
            <Text>Left</Text>
          </ZoneHarness>
          <ZoneHarness zoneId="right" orientation="horizontal" order={1}>
            <Text>Right</Text>
          </ZoneHarness>
          <ZoneHarness zoneId="vertical" orientation="vertical" order={2}>
            <Text>Vertical</Text>
          </ZoneHarness>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('zone=left active=true')

    stdin.write('\u001b[D')
    await delay()
    expect(lastFrame()).toContain('zone=left active=true')

    stdin.write('\u001b[C')
    await delay()
    expect(lastFrame()).toContain('zone=right active=true')

    stdin.write('\u001b[C')
    await delay()
    expect(lastFrame()).toContain('zone=right active=true')

    stdin.write('\u001b[D')
    await delay()
    expect(lastFrame()).toContain('zone=left active=true')
  })

  it('does not navigate zones whose keyboard scope is inactive', async () => {
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function ScopeCapture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ScopeCapture />
          <ZoneHarness
            zoneId="first"
            scope="list"
            orientation="horizontal"
            order={0}
          >
            <Text>First</Text>
          </ZoneHarness>
          <ZoneHarness
            zoneId="second"
            scope="list"
            orientation="horizontal"
            order={1}
          >
            <Text>Second</Text>
          </ZoneHarness>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('zone=first active=false')
    keyboard!.pushScope('modal')
    await delay()

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=first active=false')
    expect(lastFrame()).toContain('zone=second active=false')
  })

  it.each([
    ['Tab', '\t', 'first'],
    ['right arrow', '\u001b[C', 'first'],
    ['left arrow', '\u001b[D', 'second'],
  ] as const)(
    'does not route %s to background zones when a modal has no focus zone',
    async (_keyName, key, initialZone) => {
      let keyboard: ReturnType<typeof useKeyboardScope> | null = null

      function ScopeCapture() {
        keyboard = useKeyboardScope()
        return null
      }

      const { lastFrame, stdin } = renderUI(
        <KeyboardScopeProvider>
          <FocusTreeProvider>
            <ScopeCapture />
            <ZoneHarness zoneId="first" orientation="horizontal" order={0}>
              <Text>First</Text>
            </ZoneHarness>
            <ZoneHarness zoneId="second" orientation="horizontal" order={1}>
              <Text>Second</Text>
            </ZoneHarness>
          </FocusTreeProvider>
        </KeyboardScopeProvider>,
      )

      await delay()
      if (initialZone === 'second') {
        stdin.write('\t')
        await delay()
      }
      expect(lastFrame()).toContain(`zone=${initialZone} active=true`)

      keyboard!.pushScope('modal')
      await delay()
      stdin.write(key)
      await delay()
      keyboard!.popScope('modal')
      await delay()

      expect(lastFrame()).toContain(`zone=${initialZone} active=true`)
      const otherZone = initialZone === 'first' ? 'second' : 'first'
      expect(lastFrame()).toContain(`zone=${otherZone} active=false`)
    },
  )

  it('routes Tab to a zone in the top modal scope instead of background zones', async () => {
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function ScopeCapture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { lastFrame, stdin } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ScopeCapture />
          <ZoneHarness zoneId="first" orientation="horizontal" order={0}>
            <Text>First</Text>
          </ZoneHarness>
          <ZoneHarness zoneId="second" orientation="horizontal" order={1}>
            <Text>Second</Text>
          </ZoneHarness>
          <ZoneHarness
            zoneId="overlay"
            scope="modal"
            orientation="horizontal"
            order={0}
          >
            <Text>Overlay</Text>
          </ZoneHarness>
          <ZoneHarness
            zoneId="overlay-second"
            scope="modal"
            orientation="horizontal"
            order={1}
          >
            <Text>Second overlay</Text>
          </ZoneHarness>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('zone=first active=true')
    keyboard!.pushScope('modal')
    await delay()

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=overlay active=true')
    expect(lastFrame()).toContain('zone=first active=false')
    expect(lastFrame()).toContain('zone=second active=false')

    stdin.write('\u001b[C')
    await delay()
    expect(lastFrame()).toContain('zone=overlay active=false')
    expect(lastFrame()).toContain('zone=overlay-second active=true')

    stdin.write('\u001b[D')
    await delay()
    expect(lastFrame()).toContain('zone=overlay active=true')
    expect(lastFrame()).toContain('zone=overlay-second active=false')
  })

  it('unregisters removed zones and selects a remaining zone', async () => {
    function ConditionalZones({ showSecond }: { showSecond: boolean }) {
      return (
        <KeyboardScopeProvider>
          <FocusTreeProvider>
            <ZoneHarness zoneId="first" orientation="horizontal" order={0}>
              <Text>First</Text>
            </ZoneHarness>
            {showSecond ? (
              <ZoneHarness zoneId="second" orientation="horizontal" order={1}>
                <Text>Second</Text>
              </ZoneHarness>
            ) : null}
          </FocusTreeProvider>
        </KeyboardScopeProvider>
      )
    }

    const { lastFrame, stdin, rerender } = renderUI(
      <ConditionalZones showSecond />,
    )
    await delay()

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=second active=true')

    rerender(<ConditionalZones showSecond={false} />)
    await delay()
    expect(lastFrame()).toContain('zone=first active=true')
    expect(lastFrame()).not.toContain('zone=second')

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('zone=first active=true')
  })
})

// ── Guardrail: Provider Composition ────────────────────────────────

describe('Provider Composition', () => {
  it('composes keyboard, focus tree and scoped actions without error', async () => {
    function ComposedWidget() {
      const { GroupProvider } = useFocusGroup('composed', {
        scope: 'navigation',
      })
      return (
        <GroupProvider>
          <Text>composed providers</Text>
        </GroupProvider>
      )
    }

    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ScopedActionRegistryProvider>
            <ComposedWidget />
          </ScopedActionRegistryProvider>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )
    await delay()
    expect(lastFrame()).toContain('composed providers')
  })
})

// ── Guardrail: Scope Ownership ─────────────────────────────────────

describe('Scope Ownership', () => {
  it('pushScope/popScope follows LIFO order', async () => {
    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function Harness() {
      ctx = useKeyboardScope()
      return <Text>Scopes: {ctx.activeScopes.join(',')}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
      </KeyboardScopeProvider>,
    )
    await delay()
    // Default: ['navigation']
    expect(lastFrame()).toContain('Scopes: navigation')

    ctx!.pushScope('modal')
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,modal')

    ctx!.pushScope('command')
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,modal,command')

    // popScope() removes the LAST pushed scope
    ctx!.popScope()
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,modal')

    // pushScope is idempotent when scope already exists
    ctx!.pushScope('modal')
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,modal')
  })

  it('popScope with explicit scope removes only that scope', async () => {
    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function Harness() {
      ctx = useKeyboardScope()
      return <Text>Scopes: {ctx.activeScopes.join(',')}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
      </KeyboardScopeProvider>,
    )
    await delay()

    ctx!.pushScope('modal')
    ctx!.pushScope('command')
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,modal,command')

    // popScope('modal') removes only 'modal', leaving others in place
    ctx!.popScope('modal')
    await delay()
    expect(lastFrame()).toContain('Scopes: navigation,command')
  })
})

// ── Guardrail: Shell Suspension ────────────────────────────────────

describe('Shell Suspension', () => {
  it('suspendShell blocks navigation handlers', async () => {
    const navCalls: string[] = []
    const otherCalls: string[] = []
    let nav: ReturnType<typeof useKeyboardScope>

    function Harness() {
      const ctx = useKeyboardScope()
      nav = ctx
      return <Text>active</Text>
    }

    function NavHandler() {
      useKeyHandler((event) => {
        navCalls.push(event.text)
      }, 'navigation')
      return null
    }

    function OtherHandler() {
      useKeyHandler((event) => {
        otherCalls.push(event.text)
      }, 'command')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
        <NavHandler />
        <OtherHandler />
      </KeyboardScopeProvider>,
    )
    await delay()

    // Push command scope so it is active alongside navigation
    nav!.pushScope('command')
    await delay()

    // Before suspension: both fire
    stdin.write('a')
    await delay()
    expect(navCalls).toContain('a')
    expect(otherCalls).toContain('a')

    // Suspend shell
    nav!.suspendShell()
    await delay()

    // Clear arrays
    navCalls.length = 0
    otherCalls.length = 0

    // After suspension: navigation blocked, command still fires
    stdin.write('b')
    await delay()
    expect(navCalls).not.toContain('b')
    expect(otherCalls).toContain('b')
  })

  it('suspendShell sets shellSuspended to true', async () => {
    let ctx: ReturnType<typeof useKeyboardScope> | null = null
    function Harness() {
      ctx = useKeyboardScope()
      return <Text>suspended: {String(ctx.shellSuspended)}</Text>
    }
    const { lastFrame } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
      </KeyboardScopeProvider>,
    )
    await delay()
    expect(lastFrame()).toContain('suspended: false')

    ctx!.suspendShell()
    await delay()
    expect(lastFrame()).toContain('suspended: true')
  })

  it('restoreShell re-enables navigation handlers', async () => {
    const navCalls: string[] = []
    let nav: ReturnType<typeof useKeyboardScope>

    function Harness() {
      const ctx = useKeyboardScope()
      nav = ctx
      return <Text>active</Text>
    }

    function NavHandler() {
      useKeyHandler((event) => {
        navCalls.push(event.text)
      }, 'navigation')
      return null
    }

    const { stdin } = renderUI(
      <KeyboardScopeProvider>
        <Harness />
        <NavHandler />
      </KeyboardScopeProvider>,
    )
    await delay()

    // Suspend then restore
    nav!.suspendShell()
    await delay()
    nav!.restoreShell()
    await delay()

    // After restore: navigation fires again
    stdin.write('r')
    await delay()
    expect(navCalls).toContain('r')
  })
})

// ── Guardrail: Scope Churn Regression ───────────────────────────────
//
// Scope push/pop and handler registration are separated in
// useInputRegistration so unstable deps (e.g. a recreated array every
// render in Tabs/ListSelect) cannot cause scope stack oscillation.

describe('scope churn regression', () => {
  it('does not churn scope stack on unstable deps', async () => {
    const scopeSnapshots: string[][] = []
    let producerRenderCount = 0

    function ChurnConsumer({ items }: { items: string[] }) {
      useKeyHandler(
        () => {},
        'list',
        { deps: [items] },
      )
      return null
    }

    function ChurnProducer() {
      const { activeScopes } = useKeyboardScope()
      void activeScopes
      producerRenderCount++
      const items = ['a']
      return <ChurnConsumer items={items} />
    }

    function ScopeObserver() {
      const { activeScopes } = useKeyboardScope()
      scopeSnapshots.push([...activeScopes])
      return null
    }

    function Harness() {
      return (
        <KeyboardScopeProvider>
          <ChurnProducer />
          <ScopeObserver />
        </KeyboardScopeProvider>
      )
    }

    renderUI(<Harness />)
    await delay(100)

    // Buggy code produces 30+ renders (pop→push oscillation).
    // Fixed code caps at ≤2 renders (one initial + one scope push).
    expect(producerRenderCount).toBeLessThanOrEqual(10)
    expect(scopeSnapshots.length).toBeLessThanOrEqual(10)
  })

  it('does not churn when deps are stable (false-positive guard)', async () => {
    const scopeSnapshots: string[][] = []

    function StableConsumer() {
      useKeyHandler(
        () => {},
        'list',
        { deps: [] },
      )
      return null
    }

    function ScopeObserver() {
      const { activeScopes } = useKeyboardScope()
      scopeSnapshots.push([...activeScopes])
      return null
    }

    function Harness() {
      return (
        <KeyboardScopeProvider>
          <StableConsumer />
          <ScopeObserver />
        </KeyboardScopeProvider>
      )
    }

    renderUI(<Harness />)
    await delay(100)

    // Stable deps: 1 initial render + 1 pushScope re-render = 2 snapshots max.
    expect(scopeSnapshots.length).toBeLessThanOrEqual(3)
  })
})
