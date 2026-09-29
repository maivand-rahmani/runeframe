import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { StatusBar, type StatusBarProps } from './StatusBar.js'
import { ActionRegistry } from '../../commands/actions/ActionRegistry.js'

// Compile-time guard: the legacy direct-shortcut prop is removed.
const _shortcutsRemoved: StatusBarProps = {
  mode: 'NORMAL',
  // @ts-expect-error StatusBar.shortcuts was replaced by the scoped action registry
  shortcuts: [{ key: 'Q', description: 'Quit' }],
}
void _shortcutsRemoved

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('StatusBar', () => {
  it('renders mode indicator', () => {
    const { lastFrame } = renderInTheme(
      <StatusBar mode="NORMAL" columns={100} />,
    )
    expect(lastFrame()).toContain('Mode: NORMAL')
  })

  it('renders nothing when neither mode nor registry provided', () => {
    const { lastFrame } = renderInTheme(<StatusBar columns={100} />)
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('Mode:')
    expect(frame).not.toContain('[')
  })
})

describe('StatusBar with registry', () => {
  it('renders registry-driven hints from registered actions', () => {
    const registry = new ActionRegistry()
    registry.register({
      id: 'nav-back',
      label: 'Back',
      category: 'navigation',
      handler: () => {},
      keys: ['b'],
      scope: 'navigation',
    })
    registry.register({
      id: 'nav-forward',
      label: 'Forward',
      category: 'navigation',
      handler: () => {},
      keys: ['f'],
      scope: 'navigation',
    })

    const { lastFrame } = renderInTheme(
      <StatusBar mode="NORMAL" columns={100} registry={registry} />,
    )

    expect(lastFrame()).toContain('Mode: NORMAL')
    expect(lastFrame()).toContain('[b] Back')
    expect(lastFrame()).toContain('[f] Forward')
  })

  it('renders with only registry (no mode)', () => {
    const registry = new ActionRegistry()
    registry.register({
      id: 'close',
      label: 'Close',
      category: 'system',
      handler: () => {},
      keys: ['c'],
      scope: 'navigation',
    })

    const { lastFrame } = renderInTheme(
      <StatusBar columns={100} registry={registry} />,
    )

    expect(lastFrame()).toContain('[c] Close')
    expect(lastFrame()).not.toContain('Mode:')
  })

  it('limits registry hints to two in compact mode', () => {
    const registry = new ActionRegistry()
    registry.register({
      id: 'one',
      label: 'Alpha',
      category: 'system',
      handler: () => {},
      keys: ['1'],
      scope: 'navigation',
    })
    registry.register({
      id: 'two',
      label: 'Beta',
      category: 'system',
      handler: () => {},
      keys: ['2'],
      scope: 'navigation',
    })
    registry.register({
      id: 'three',
      label: 'Gamma',
      category: 'system',
      handler: () => {},
      keys: ['3'],
      scope: 'navigation',
    })

    const { lastFrame } = renderInTheme(
      <StatusBar mode="NORMAL" columns={70} registry={registry} />,
    )

    expect(lastFrame()).toContain('Mode: NORMAL')
    expect(lastFrame()).toContain('[1] Alpha')
    expect(lastFrame()).toContain('[2] Beta')
    expect(lastFrame()).not.toContain('[3] Gamma')
  })
})
