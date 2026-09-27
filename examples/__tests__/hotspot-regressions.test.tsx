import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { Text } from 'ink'
import { normalizeFrame } from '../../test/integration-helpers.js'

import { AppShell } from '../../src/components/AppShell.js'
import { Sidebar } from '../../src/components/Sidebar.js'
import { KeyboardScopeProvider } from '../../src/interaction/KeyboardScopeProvider.js'
import { NavigationProvider } from '../../src/navigation/NavigationProvider.js'
import { ScreenRegistry } from '../../src/screens/registry.js'
import { ModalProvider } from '../../src/components/ModalProvider.js'
import { ToastProvider } from '../../src/components/ToastProvider.js'
import { ThemeProvider } from '../../src/design-system/ThemeProvider.js'
import { ScopedActionRegistryProvider, useRegisterActions } from '../../src/commands/ScopedActionRegistryProvider.js'
import { HotkeyHintBar } from '../../src/components/HotkeyHintBar.js'

const registry = new ScreenRegistry()
registry.register({ id: 'home', title: 'Home', component: () => React.createElement(Text, null, 'Home'), sidebar: true, category: 'main' })
registry.register({ id: 'settings', title: 'Settings', component: () => React.createElement(Text, null, 'Settings'), sidebar: true, category: 'main' })

// ── AppShell + Sidebar scroll interaction ──
describe('AppShell + Sidebar', () => {
  it('renders with sidebarPosition=fixed without crashing', () => {
    const { lastFrame } = render(
      React.createElement(KeyboardScopeProvider, { defaultScope: 'navigation' },
        React.createElement(NavigationProvider, { registry, defaultScreen: 'home' },
          React.createElement(AppShell, {
            sidebar: React.createElement(Sidebar, {
              items: [
                { id: 'home', label: 'Home' },
                { id: 'settings', label: 'Settings' },
              ],
              sectionTitles: { main: 'Main' },
              onActivate: () => {},
              currentScreenId: 'home',
            }),
            sidebarPosition: 'fixed' as const,
            scrollContent: true,
          }, React.createElement(Text, null, 'Content')),
        ),
      ),
    )
    expect(normalizeFrame(lastFrame())).toBeTruthy()
  })
})

// ── Modal + Toast coexistence ──
describe('Modal + Toast coexistence', () => {
  it('renders ModalProvider inside ToastProvider without crashing', () => {
    const { lastFrame } = render(
      React.createElement(ThemeProvider, null,
        React.createElement(KeyboardScopeProvider, null,
          React.createElement(NavigationProvider, { registry, defaultScreen: 'home' },
            React.createElement(ToastProvider, null,
              React.createElement(ModalProvider, null,
                React.createElement(Text, null, 'Modal+Toast content'),
              ),
            ),
          ),
        ),
      ),
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Modal+Toast content')
  })
})

// ── HotkeyHintBar + ScopedActionRegistryProvider ──
function HintBarWithActions() {
  useRegisterActions([
    { id: 'save', label: 'Save', keys: ['ctrl+s'], handler: () => {}, scope: 'command', category: 'system' },
    { id: 'quit', label: 'Quit', keys: ['ctrl+q'], handler: () => {}, scope: 'command', category: 'system' },
  ])
  return React.createElement(HotkeyHintBar, { scope: 'command', maxHints: 4 })
}

describe('HotkeyHintBar + ScopedActionRegistry', () => {
  it('renders hint bar with registered actions', () => {
    const { lastFrame } = render(
      React.createElement(ScopedActionRegistryProvider, null,
        React.createElement(HintBarWithActions),
      ),
    )
    expect(normalizeFrame(lastFrame())).toBeTruthy()
  })
})
