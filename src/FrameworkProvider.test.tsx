import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { Text } from 'ink'
import {
  FrameworkProvider,
  type FrameworkProviderProps,
} from './FrameworkProvider.js'
import { ScreenRegistry } from './screens/registry.js'
import { useTheme } from './design-system/ThemeProvider.js'
import { useKeyboardScope } from './interaction/KeyboardScopeProvider.js'
import { useFocusGroup, useFocusable } from './interaction/FocusTreeProvider.js'
import {
  useRegisterActions,
  useScopedActionRegistry,
} from './commands/ScopedActionRegistryProvider.js'
import { useNavigation } from './navigation/NavigationProvider.js'
import { useModal } from './components/ModalProvider.js'
import { useToast } from './components/ToastProvider.js'
import { HotkeyHintBar } from './components/HotkeyHintBar.js'
import { ConfirmModal } from './components/ConfirmModal.js'
import { List, type ListItem } from './components/List.js'

const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  component: () => React.createElement(Text, null, 'HomeScreen'),
  sidebar: true,
  category: 'main',
})
registry.register({
  id: 'confirm-dialog',
  title: 'Confirm',
  component: () =>
    React.createElement(ConfirmModal, {
      message: 'Delete this item?',
      onConfirm: () => {},
      onCancel: () => {},
    }),
  sidebar: false,
  category: 'system',
})

function TestChild() {
  return React.createElement(Text, null, 'child renders')
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForFrame(
  getFrame: () => string | undefined,
  expected: string,
  timeoutMs = 1500,
): Promise<string> {
  const start = Date.now()
  let frame = getFrame() ?? ''
  while (Date.now() - start < timeoutMs) {
    if (frame.includes(expected)) return frame
    await delay(20)
    frame = getFrame() ?? ''
  }
  return frame
}

// ── Compile-time guard: legacy composition props are removed ─────────
// Each legacy prop is asserted in its own literal because TypeScript
// reports a single excess-property error per object literal.

const _legacyBase = {
  children: null,
  registry,
  defaultScreen: 'home',
}

const _legacyWithRegionProvider: FrameworkProviderProps = {
  ..._legacyBase,
  // @ts-expect-error withRegionProvider was removed from FrameworkProvider
  withRegionProvider: false,
}

const _legacyWithModalProvider: FrameworkProviderProps = {
  ..._legacyBase,
  // @ts-expect-error withModalProvider was removed from FrameworkProvider
  withModalProvider: true,
}

const _legacyWithToastProvider: FrameworkProviderProps = {
  ..._legacyBase,
  // @ts-expect-error withToastProvider was removed from FrameworkProvider
  withToastProvider: true,
}

const _legacyDefaultScope: FrameworkProviderProps = {
  ..._legacyBase,
  // @ts-expect-error defaultScope was removed from FrameworkProvider
  defaultScope: 'navigation',
}

const _legacyDefaultRegion: FrameworkProviderProps = {
  ..._legacyBase,
  // @ts-expect-error defaultRegion was removed from FrameworkProvider
  defaultRegion: 'content',
}

void _legacyWithRegionProvider
void _legacyWithModalProvider
void _legacyWithToastProvider
void _legacyDefaultScope
void _legacyDefaultRegion

describe('FrameworkProvider', () => {
  it('renders children with default options', () => {
    const { lastFrame } = render(
      React.createElement(
        FrameworkProvider,
        { registry, defaultScreen: 'home', children: React.createElement(TestChild) },
      ),
    )
    expect(lastFrame()).toBeTruthy()
    expect(lastFrame()).toContain('child renders')
  })

  it('provides the complete provider stack by default', () => {
    function StackProbe() {
      const { colors } = useTheme()
      const keyboard = useKeyboardScope()
      const actions = useScopedActionRegistry()
      const nav = useNavigation()
      const modal = useModal()
      const toast = useToast()
      const item = useFocusable({ id: 'probe' })
      const group = useFocusGroup('probe-group', { scope: 'navigation' })

      const ok =
        colors.text.primary.length > 0 &&
        keyboard.activeScope.length > 0 &&
        typeof actions.registerActions === 'function' &&
        nav.currentScreenId === 'home' &&
        modal.isOpen === false &&
        typeof toast === 'object' &&
        item.id === 'probe' &&
        group.groupId === 'probe-group'

      return React.createElement(Text, null, ok ? 'stack-ok' : 'stack-broken')
    }

    const { lastFrame } = render(
      React.createElement(
        FrameworkProvider,
        { registry, defaultScreen: 'home', children: React.createElement(StackProbe) },
      ),
    )
    expect(lastFrame()).toContain('stack-ok')
  })

  it('hosts the scoped action registry by default', async () => {
    function ActionConsumer() {
      useRegisterActions([
        {
          id: 'save',
          label: 'Save',
          category: 'system',
          handler: () => {},
          keys: ['ctrl+s'],
          scope: 'navigation',
        },
      ])
      return React.createElement(HotkeyHintBar)
    }

    const { lastFrame } = render(
      React.createElement(
        FrameworkProvider,
        { registry, defaultScreen: 'home', children: React.createElement(ActionConsumer) },
      ),
    )
    const frame = await waitForFrame(lastFrame, '[ctrl+s] Save')
    expect(frame).toContain('[ctrl+s] Save')
  })

  it('hosts modals and toasts by default', async () => {
    function Trigger() {
      const { openModal } = useModal()
      const { toast } = useToast()
      React.useEffect(() => {
        openModal('confirm-dialog')
        toast('success', 'Saved')
      }, [openModal, toast])
      return React.createElement(Text, null, 'main content')
    }

    const { lastFrame } = render(
      React.createElement(
        FrameworkProvider,
        { registry, defaultScreen: 'home', children: React.createElement(Trigger) },
      ),
    )
    const frame = await waitForFrame(lastFrame, 'Delete this item?')
    expect(frame).toContain('Delete this item?')
    expect(frame).toContain('Saved')
  })

  it('supports FocusTree widgets (List) end-to-end', async () => {
    const activated: string[] = []
    const items: ListItem[] = [
      { id: 'a', label: 'Item Alpha' },
      { id: 'b', label: 'Item Beta' },
    ]

    function ListHost() {
      return React.createElement(List, {
        items,
        onActivate: (id: string) => activated.push(id),
        renderItem: (item: ListItem, state: { focused: boolean }) =>
          React.createElement(
            Text,
            null,
            `${item.label}${state.focused ? '*' : ''}`,
          ),
      })
    }

    const { lastFrame, stdin } = render(
      React.createElement(
        FrameworkProvider,
        { registry, defaultScreen: 'home', children: React.createElement(ListHost) },
      ),
    )

    await waitForFrame(lastFrame, 'Item Alpha*')
    stdin.write('\u001b[B')
    await waitForFrame(lastFrame, 'Item Beta*')
    stdin.write('\r')
    await delay()
    expect(activated).toContain('b')
    expect(lastFrame()).toContain('Item Beta*')
  })
})
