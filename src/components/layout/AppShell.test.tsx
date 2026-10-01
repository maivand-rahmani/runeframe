import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { AppShell } from './AppShell.js'
import { List } from '../selection/List.js'
import { Button } from '../primitives/Button.js'
import { useToast } from '../feedback/ToastProvider.js'

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

type ToastFn = ReturnType<typeof useToast>['toast']

function ToastHarness({ capture }: { capture: { toast: ToastFn | null } }) {
  const { toast } = useToast()
  capture.toast = toast
  return null
}

/**
 * Real-app provider order: the anchored mouse root encloses the framework
 * (including the toast host), so toast rows shift the shell down while the
 * asserted origin stays correct.
 */
function renderInAnchoredFrameworkShell(ui: ReactElement) {
  return render(
    <MouseLayout origin={{ x: 0, y: 0 }} width={100} flexDirection="column">
      <FrameworkProvider registry={appShellRegistry} defaultScreen="shell-test">
        {ui}
      </FrameworkProvider>
    </MouseLayout>,
  )
}

function plainFrame(frame: string | undefined) {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function frameRowCount(frame: string | undefined) {
  const lines = plainFrame(frame).split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
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

  it('fits the full fixed-sidebar shell to terminal rows without losing scroll or click geometry', async () => {
    const activated: string[] = []
    const contentRows = Array.from({ length: 28 }, (_, index) =>
      index === 1 ? (
        <Button key={index} focused onActivate={() => activated.push('go')}>
          Go
        </Button>
      ) : (
        <Text key={index}>Shell row {index}</Text>
      ),
    )
    const shell = (
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
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">{contentRows}</MouseLayout>
        </AppShell>
      </MouseLayout>
    )

    const { stdin, stdout, lastFrame } = renderInFrameworkShell(shell)
    const initialFrame = lastFrame()
    // Ink's testing stdout omits `rows`, so useWindowSize starts at its normal
    // 24-row fallback. The first commit must already respect that constraint.
    expect(frameRowCount(initialFrame)).toBeLessThanOrEqual(24)
    expect(initialFrame).toContain('Top bar')
    expect(initialFrame).toContain('Navigation')
    expect(initialFrame).toContain('Status bar')
    expect(initialFrame).toContain('Shell row 0')

    // Then exercise a real Ink resize. Box metrics are measured from the
    // constrained layout; no viewport dimensions are mocked in this test.
    const resizableStdout = stdout as unknown as {
      rows: number
      emit: (event: string) => boolean
    }
    resizableStdout.rows = 12
    resizableStdout.emit('resize')
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(12)
    expect(lastFrame()).toContain('Top bar')
    expect(lastFrame()).toContain('Navigation')
    expect(lastFrame()).toContain('Status bar')

    const topCell = cellInFrame(lastFrame(), 'Shell row 0')
    await wheelAtCell(stdin, topCell, 'down')
    const scrolledFrame = lastFrame()
    expect(scrolledFrame).not.toContain('Shell row 0')
    expect(scrolledFrame).toContain('[Go]')
    expect(frameRowCount(scrolledFrame)).toBeLessThanOrEqual(12)

    await clickAtCell(stdin, cellInFrame(scrolledFrame, '[Go]'))
    expect(activated).toEqual(['go'])
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(12)
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

  it('reserves toast rows so the constrained shell and toast host never exceed the terminal', async () => {
    const activated: string[] = []
    const contentRows = Array.from({ length: 28 }, (_, index) =>
      index === 1 ? (
        <Button key={index} focused onActivate={() => activated.push('go')}>
          Go
        </Button>
      ) : (
        <Text key={index}>Toast shell row {index}</Text>
      ),
    )
    const capture: { toast: ToastFn | null } = { toast: null }
    const { stdin, stdout, lastFrame } = renderInAnchoredFrameworkShell(
      <>
        <ToastHarness capture={capture} />
        <AppShell
          columns={100}
          topBar={<Text>Top bar</Text>}
          sidebar={<Text>Navigation</Text>}
          statusBar={<Text>Status bar</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">{contentRows}</MouseLayout>
        </AppShell>
      </>,
    )
    await new Promise((resolve) => setTimeout(resolve, 140))
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(24)
    expect(lastFrame()).toContain('Toast shell row 0')

    const firstToast = capture.toast!('info', 'Toast one')
    capture.toast!('warning', 'Toast two')
    await new Promise((resolve) => setTimeout(resolve, 140))

    expect(lastFrame()).toContain('Toast one')
    expect(lastFrame()).toContain('Toast two')
    expect(lastFrame()).toContain('Top bar')
    expect(lastFrame()).toContain('Status bar')
    // Two toast rows above a shell that reserved exactly rows - 2.
    expect(frameRowCount(lastFrame())).toBe(24)

    // A shorter terminal moves the reservation with the detected rows.
    const resizableStdout = stdout as unknown as {
      rows: number
      emit: (event: string) => boolean
    }
    resizableStdout.rows = 18
    resizableStdout.emit('resize')
    await new Promise((resolve) => setTimeout(resolve, 140))
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(18)

    const topCell = cellInFrame(lastFrame(), 'Toast shell row 0')
    await wheelAtCell(stdin, topCell, 'down')
    const scrolledFrame = lastFrame()
    expect(scrolledFrame).not.toContain('Toast shell row 0')
    expect(scrolledFrame).toContain('[Go]')
    expect(frameRowCount(scrolledFrame)).toBeLessThanOrEqual(18)

    await clickAtCell(stdin, cellInFrame(scrolledFrame, '[Go]'))
    expect(activated).toEqual(['go'])

    firstToast.dismiss()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(lastFrame()).not.toContain('Toast one')
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(18)
  })

  it('clips the constrained shell safely when the terminal is shorter than its chrome', async () => {
    const capture: { toast: ToastFn | null } = { toast: null }
    const { stdout, lastFrame } = renderInAnchoredFrameworkShell(
      <>
        <ToastHarness capture={capture} />
        <AppShell
          columns={100}
          topBar={<Text>Top bar</Text>}
          statusBar={<Text>Status bar</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">
            {Array.from({ length: 28 }, (_, index) => (
              <Text key={index}>Tiny shell row {index}</Text>
            ))}
          </MouseLayout>
        </AppShell>
      </>,
    )
    const resizableStdout = stdout as unknown as {
      rows: number
      emit: (event: string) => boolean
    }
    resizableStdout.rows = 2
    resizableStdout.emit('resize')
    await new Promise((resolve) => setTimeout(resolve, 140))

    capture.toast!('info', 'Tiny toast')
    await new Promise((resolve) => setTimeout(resolve, 140))
    expect(lastFrame()).toContain('Tiny toast')
    // One toast row above the one-row floor of the clipped shell.
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(2)

    resizableStdout.rows = 1
    resizableStdout.emit('resize')
    await new Promise((resolve) => setTimeout(resolve, 140))
    // The host yields its row entirely; the shell clips to its single row.
    expect(lastFrame()).not.toContain('Tiny toast')
    expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(1)
  })

  it.each([
    { label: 'narrow columns', columns: 70, withSidebar: true },
    { label: 'missing sidebar', columns: 100, withSidebar: false },
  ])(
    'constrains the scrollContent shell when the sidebar is hidden ($label)',
    async ({ columns, withSidebar }) => {
      const activated: string[] = []
      const contentRows = Array.from({ length: 28 }, (_, index) =>
        index === 1 ? (
          <Button key={index} focused onActivate={() => activated.push('go')}>
            Go
          </Button>
        ) : (
          <Text key={index}>Hidden shell row {index}</Text>
        ),
      )
      const { stdin, stdout, lastFrame } = renderInAnchoredFrameworkShell(
        <AppShell
          columns={columns}
          sidebar={withSidebar ? <Text>Navigation</Text> : undefined}
          topBar={<Text>Top bar</Text>}
          statusBar={<Text>Status bar</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <MouseLayout flexDirection="column">{contentRows}</MouseLayout>
        </AppShell>,
      )
      const resizableStdout = stdout as unknown as {
        rows: number
        emit: (event: string) => boolean
      }
      resizableStdout.rows = 18
      resizableStdout.emit('resize')
      await new Promise((resolve) => setTimeout(resolve, 140))

      expect(lastFrame()).not.toContain('Navigation')
      expect(lastFrame()).toContain('Top bar')
      expect(lastFrame()).toContain('Status bar')
      expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(18)
      // Hidden sidebar means no reserved column and no left margin.
      expect(cellInFrame(lastFrame(), 'Hidden shell row 0').x).toBe(0)

      const topCell = cellInFrame(lastFrame(), 'Hidden shell row 0')
      await wheelAtCell(stdin, topCell, 'down')
      const scrolledFrame = lastFrame()
      expect(scrolledFrame).not.toContain('Hidden shell row 0')
      expect(scrolledFrame).toContain('[Go]')
      expect(frameRowCount(scrolledFrame)).toBeLessThanOrEqual(18)

      await clickAtCell(stdin, cellInFrame(scrolledFrame, '[Go]'))
      expect(activated).toEqual(['go'])
      expect(frameRowCount(lastFrame())).toBeLessThanOrEqual(18)
    },
  )

  it('keeps natural-height legacy layout when scrollContent is off with a hidden sidebar', async () => {
    const { stdin, lastFrame } = renderInFrameworkShell(
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={100}
        flexDirection="column"
      >
        <AppShell
          columns={70}
          sidebar={<Text>Navigation</Text>}
          sidebarPosition="fixed"
        >
          <MouseLayout flexDirection="column">
            {Array.from({ length: 28 }, (_, index) => (
              <Text key={index}>Legacy row {index}</Text>
            ))}
          </MouseLayout>
        </AppShell>
      </MouseLayout>,
    )
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(lastFrame()).not.toContain('Navigation')
    // Legacy mode keeps the natural height: nothing is clipped, and wheel
    // scrolling stays gated because scrollContent is opt-in.
    expect(lastFrame()).toContain('Legacy row 27')
    const topCell = cellInFrame(lastFrame(), 'Legacy row 0')
    await wheelAtCell(stdin, topCell, 'down')
    expect(lastFrame()).toContain('Legacy row 0')
  })
})
