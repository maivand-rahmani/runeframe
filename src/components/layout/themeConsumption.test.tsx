import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import chalk from 'chalk'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import type { ThemeOverrides } from '../../types.js'
import { AppShell } from './AppShell.js'
import { StatusBar } from './StatusBar.js'
import { TopBar } from './TopBar.js'

function renderThemed(ui: ReactElement, theme?: ThemeOverrides) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const shellRegistry = new ScreenRegistry()
shellRegistry.register({
  id: 'shell-theme-test',
  title: 'Shell theme test',
  component: () => null,
})

function renderShell(ui: ReactElement, theme?: ThemeOverrides) {
  return render(
    <FrameworkProvider
      registry={shellRegistry}
      defaultScreen="shell-theme-test"
      theme={theme}
    >
      {ui}
    </FrameworkProvider>,
  )
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function cellInFrame(frame: string | undefined, text: string) {
  const lines = plain(frame).split(/\r?\n/)
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${JSON.stringify(text)} in frame`)
  return { x: lines[y]!.indexOf(text), y }
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

describe('layout theme consumption', () => {
  it('keeps TopBar defaults without a theme', () => {
    const { lastFrame } = renderThemed(
      <TopBar appName="Runeframe" screenTitle="Dashboard" columns={100} />,
    )

    expect(plain(lastFrame())).toContain('Runeframe \u2014 Dashboard')
  })

  it('consumes global narrow-column metrics in TopBar', () => {
    const { lastFrame } = renderThemed(
      <TopBar appName="Runeframe" screenTitle="Dashboard" columns={100} />,
      { layout: { narrowColumns: 120 } },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('Runeframe')
    expect(frame).not.toContain('Dashboard')
  })

  it('consumes per-component TopBar separator symbols', () => {
    const { lastFrame } = renderThemed(
      <TopBar appName="Runeframe" screenTitle="Dashboard" columns={100} />,
      { components: { topBar: { symbols: { separator: '/' } } } },
    )

    expect(plain(lastFrame())).toContain('Runeframe / Dashboard')
  })

  it('consumes per-component StatusBar mode colors', () => {
    chalk.level = 1
    const { lastFrame } = renderThemed(<StatusBar mode="NORMAL" columns={100} />, {
      components: { statusBar: { colors: { mode: 'magenta' } } },
    })

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Mode: NORMAL')
    expect(frame).toContain('\u001B[35m')
  })

  it('consumes global sidebar width in AppShell', () => {
    const defaultFrame = renderShell(
      <AppShell columns={100} sidebar={<Text>Nav</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    expect(cellInFrame(defaultFrame.lastFrame(), 'Content').x).toBe(21)

    const narrowFrame = renderShell(
      <AppShell columns={100} sidebar={<Text>Nav</Text>}>
        <Text>Content</Text>
      </AppShell>,
      { layout: { sidebarWidth: 5 } },
    )
    expect(cellInFrame(narrowFrame.lastFrame(), 'Content').x).toBe(6)
  })

  it('consumes global status bar border style in AppShell', () => {
    const { lastFrame } = renderShell(
      <AppShell columns={100} statusBar={<Text>Status</Text>}>
        <Text>Content</Text>
      </AppShell>,
      { layout: { statusBarBorderStyle: 'double' } },
    )

    expect(plain(lastFrame())).toContain('\u2554')
  })

  it('prefers per-component AppShell border style over global layout', () => {
    const { lastFrame } = renderShell(
      <AppShell columns={100} statusBar={<Text>Status</Text>}>
        <Text>Content</Text>
      </AppShell>,
      {
        layout: { statusBarBorderStyle: 'double' },
        components: { appShell: { borderStyle: 'single' } },
      },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('\u250c')
    expect(frame).not.toContain('\u2554')
  })

  it('consumes per-component AppShell spacing', () => {
    const defaultFrame = renderShell(
      <AppShell columns={100} topBar={<Text>Top</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    const compactFrame = renderShell(
      <AppShell columns={100} topBar={<Text>Top</Text>}>
        <Text>Content</Text>
      </AppShell>,
      { components: { appShell: { spacing: { topBarMarginBottom: 0 } } } },
    )

    const defaultLines = plain(defaultFrame.lastFrame()).split('\n')
    const compactLines = plain(compactFrame.lastFrame()).split('\n')
    expect(defaultLines.indexOf('Content')).toBe(3)
    expect(compactLines.indexOf('Content')).toBe(1)
  })
})
