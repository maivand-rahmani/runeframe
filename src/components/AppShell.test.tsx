import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { AppShell } from './AppShell.js'
import { List } from './List.js'
import { Button } from './Button.js'

function renderInShell(ui: ReactElement) {
  return render(
    <KeyboardScopeProvider>
      <ThemeProvider>{ui}</ThemeProvider>
    </KeyboardScopeProvider>,
  )
}

const appShellRegistry = new ScreenRegistry()
appShellRegistry.register({
  id: 'shell-test',
  title: 'Shell test',
  component: () => null,
})

function renderInFrameworkShell(ui: ReactElement) {
  return render(
    <FrameworkProvider registry={appShellRegistry} defaultScreen="shell-test">
      {ui}
    </FrameworkProvider>,
  )
}

function plainFrame(frame: string | undefined) {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function cellInFrame(frame: string | undefined, text: string) {
  const lines = plainFrame(frame).split(/\r?\n/)
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${JSON.stringify(text)} in frame`)
  return { x: lines[y]!.indexOf(text), y }
}

async function wheelAtCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
  direction: 'up' | 'down',
) {
  const button = direction === 'up' ? 64 : 65
  stdin.write(`\u001B[<${button};${cell.x + 1};${cell.y + 1}M`)
  await new Promise((resolve) => setTimeout(resolve, 60))
}

async function clickAtCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}M`)
  await new Promise((resolve) => setTimeout(resolve, 50))
  stdin.write(`\u001B[<0;${x};${y}m`)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('AppShell', () => {
  it('renders children in content area', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100}>
        <Text>Screen Content</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Screen Content')
  })

  it('renders TopBar when provided', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100} topBar={<Text>App Title</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('App Title')
  })

  it('renders Sidebar when provided and wide', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100} sidebar={<Text>Navigation</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Navigation')
    expect(lastFrame()).toContain('Content')
  })

  it('renders StatusBar when provided', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100} statusBar={<Text>Ctrl+C Quit</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Ctrl+C Quit')
  })

  it('renders all four regions together', () => {
    const { lastFrame } = renderInShell(
      <AppShell
        columns={120}
        topBar={<Text>Top</Text>}
        sidebar={<Text>Side</Text>}
        statusBar={<Text>Status</Text>}
      >
        <Text>Main</Text>
      </AppShell>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Top')
    expect(frame).toContain('Side')
    expect(frame).toContain('Main')
    expect(frame).toContain('Status')
  })

  it('renders without TopBar', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100}>
        <Text>Content Only</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Content Only')
  })

  it('renders without Sidebar', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100}>
        <Text>No Sidebar</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('No Sidebar')
  })

  it('renders without StatusBar', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100}>
        <Text>No Status</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('No Status')
  })

  it('hides sidebar on narrow terminal (< 80 cols)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={70} sidebar={<Text>Nav</Text>}>
        <Text>Content</Text>
      </AppShell>,
    )
    expect(lastFrame()).not.toContain('Nav')
    expect(lastFrame()).toContain('Content')
  })

  it('shows sidebar at medium width (80-99 cols)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={90} sidebar={<Text>Nav</Text>}>
        <Text>Main</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Nav')
    expect(lastFrame()).toContain('Main')
  })

  it('shows sidebar at wide width (>= 100 cols)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={120} sidebar={<Text>Side</Text>}>
        <Text>Main Content Area</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Side')
    expect(lastFrame()).toContain('Main Content Area')
  })

  it('treats exactly 80 as medium (sidebar visible)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={80} sidebar={<Text>Side</Text>}>
        <Text>Main</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Side')
  })

  it('treats exactly 100 as wide (sidebar visible)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={100} sidebar={<Text>Side</Text>}>
        <Text>Main</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Side')
    expect(lastFrame()).toContain('Main')
  })

  it('treats 79 as narrow (sidebar hidden)', () => {
    const { lastFrame } = renderInShell(
      <AppShell columns={79} sidebar={<Text>Side</Text>}>
        <Text>Main</Text>
      </AppShell>,
    )
    expect(lastFrame()).not.toContain('Side')
  })

  it.each(['flow', 'fixed'] as const)(
    'composes automatic mouse targets through the %s layout wrappers',
    async (sidebarPosition) => {
      const activated: string[] = []
      const { stdin, lastFrame } = renderInFrameworkShell(
        <MouseLayout
          origin={{ x: 0, y: 0 }}
          width={100}
          flexDirection="column"
        >
          <AppShell
            columns={100}
            topBar={<Text>Top bar</Text>}
            sidebar={<Text>Navigation</Text>}
            statusBar={<Text>Status bar</Text>}
            sidebarPosition={sidebarPosition}
          >
            <MouseLayout flexDirection="column">
              <Button focused onActivate={() => activated.push('go')}>
                Go
              </Button>
            </MouseLayout>
          </AppShell>
        </MouseLayout>,
      )
      await new Promise((resolve) => setTimeout(resolve, 250))

      const cell = cellInFrame(lastFrame(), '[Go]')
      await clickAtCell(stdin, cell)
      expect(activated).toEqual(['go'])
    },
  )

  it('handles undefined window size gracefully', () => {
    const { lastFrame } = renderInShell(
      <AppShell sidebar={<Text>Side</Text>}>
        <Text>Main</Text>
      </AppShell>,
    )
    expect(lastFrame()).toContain('Main')
  })

  it('wheel-scrolls fixed sidebar content one row at a time and clamps to measured content', async () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => (
        <Text key={index}>Shell row {index}</Text>
      ))
    const view = (count: number) => (
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={100}
        flexDirection="column"
      >
        <AppShell
          columns={100}
          sidebar={<Text>Navigation</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">{rows(count)}</MouseLayout>
        </AppShell>
      </MouseLayout>
    )

    const { stdin, stdout, lastFrame, rerender } = renderInFrameworkShell(view(28))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(lastFrame()).toContain('Shell row 0')

    const topCell = cellInFrame(lastFrame(), 'Shell row 0')
    await wheelAtCell(stdin, topCell, 'down')
    expect(lastFrame()).not.toContain('Shell row 0')
    expect(lastFrame()).toContain('Shell row 1')

    // The maximum is content height minus the measured viewport, not a fixed
    // ceiling. At the bottom, the final content row is visible and extra wheel
    // reports are consumed without moving beyond it.
    for (let index = 0; index < 40; index++) {
      await wheelAtCell(stdin, topCell, 'down')
    }
    expect(lastFrame()).toContain('Shell row 27')
    const bottomFrame = lastFrame()
    await wheelAtCell(stdin, topCell, 'down')
    expect(lastFrame()).toBe(bottomFrame)

    const resizableStdout = stdout as unknown as {
      rows: number
      emit: (event: string) => boolean
    }
    resizableStdout.rows = 40
    resizableStdout.emit('resize')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lastFrame()).toContain('Shell row 0')

    rerender(
      <FrameworkProvider
        registry={appShellRegistry}
        defaultScreen="shell-test"
      >
        {view(2)}
      </FrameworkProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lastFrame()).toContain('Shell row 0')
    expect(lastFrame()).not.toContain('Shell row 2')
  })

  it.each([
    { mode: 'flow', sidebarPosition: 'flow' as const, scrollContent: true },
    { mode: 'fixed without scrollContent', sidebarPosition: 'fixed' as const, scrollContent: false },
  ])('keeps wheel scrolling gated for $mode layout', async ({ sidebarPosition, scrollContent }) => {
    const { stdin, lastFrame } = renderInFrameworkShell(
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={100}
        flexDirection="column"
      >
        <AppShell
          columns={100}
          sidebar={<Text>Navigation</Text>}
          sidebarPosition={sidebarPosition}
          scrollContent={scrollContent}
        >
          <MouseLayout flexDirection="column">
            {Array.from({ length: 28 }, (_, index) => (
              <Text key={index}>Gate row {index}</Text>
            ))}
          </MouseLayout>
        </AppShell>
      </MouseLayout>,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const topCell = cellInFrame(lastFrame(), 'Gate row 0')
    await wheelAtCell(stdin, topCell, 'down')
    expect(lastFrame()).toContain('Gate row 0')
  })

  it('bubbles a List boundary wheel to its enclosing AppShell after the List moves first', async () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      id: `item-${index}`,
      label: `Nested item ${index}`,
    }))
    const rows = Array.from({ length: 28 }, (_, index) => (
      <Text key={index}>Tail row {index}</Text>
    ))
    const { stdin, lastFrame } = renderInFrameworkShell(
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={100}
        flexDirection="column"
      >
        <AppShell
          columns={100}
          sidebar={<Text>Navigation</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">
            <Text>Shell anchor</Text>
            <List items={items} maxVisible={2} />
            {rows}
          </MouseLayout>
        </AppShell>
      </MouseLayout>,
    )
    await new Promise((resolve) => setTimeout(resolve, 140))

    const innerCell = cellInFrame(lastFrame(), 'Nested item 0')
    await wheelAtCell(stdin, innerCell, 'down')
    expect(lastFrame()).toContain('Shell anchor')
    expect(lastFrame()).toContain('Nested item 2')
    expect(lastFrame()).not.toContain('Nested item 0')

    // The next child move reaches its bottom boundary. It returns false, so
    // AppShell takes the same wheel step and clips the original anchor away.
    await wheelAtCell(stdin, innerCell, 'down')
    expect(lastFrame()).toContain('Nested item 3')
    await wheelAtCell(stdin, innerCell, 'down')
    expect(lastFrame()).not.toContain('Shell anchor')
  })
})
