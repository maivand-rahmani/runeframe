import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Box, Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { FocusTreeProvider, useFocusable, useFocusGroup } from '../interaction/FocusTreeProvider.js'
import { NavigationProvider, useNavigation } from '../navigation/NavigationProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { AppShell } from './AppShell.js'
import { Sidebar, type SidebarItem } from './Sidebar.js'
import { Button } from './Button.js'

function createTestRegistry() {
  const registry = new ScreenRegistry()

  registry.register({
    id: 'dashboard',
    title: 'Dashboard',
    component: () => <Text>Dashboard Screen</Text>,
    category: 'main',
    sidebar: true,
  })
  registry.register({
    id: 'plan',
    title: 'Plan',
    component: () => <Text>Plan Screen</Text>,
    category: 'main',
    sidebar: true,
  })
  registry.register({
    id: 'lessons',
    title: 'Lessons',
    component: () => <Text>Lessons Screen</Text>,
    category: 'learning',
    sidebar: true,
  })
  registry.register({
    id: 'speak',
    title: 'Speaking',
    component: () => <Text>Speaking Screen</Text>,
    category: 'learning',
    sidebar: true,
  })
  registry.register({
    id: 'config',
    title: 'Settings',
    component: () => <Text>Settings Screen</Text>,
    category: 'system',
    sidebar: true,
  })

  return registry
}

const sidebarItems: SidebarItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Overview and progress',
    category: 'main',
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Today\'s study plan',
    category: 'main',
  },
  {
    id: 'lessons',
    label: 'Lessons',
    description: 'Browse lesson packs',
    category: 'learning',
  },
  {
    id: 'speak',
    label: 'Speaking',
    description: 'Practice spoken output',
    category: 'learning',
  },
  {
    id: 'config',
    label: 'Settings',
    description: 'System preferences',
    category: 'system',
  },
]

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cellInFrame(frame: string | undefined, text: string) {
  const plain = (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  const lines = plain.split(/\r?\n/)
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${JSON.stringify(text)} in frame`)
  return { x: lines[y].indexOf(text), y }
}

async function clickCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}M`)
  await delay()
  stdin.write(`\u001B[<0;${x};${y}m`)
  await delay()
}

describe('Sidebar', () => {
  let registry: ScreenRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('renders grouped sections inside AppShell sidebar slot', async () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <AppShell
            columns={120}
            sidebar={<Sidebar items={sidebarItems} columns={120} />}
          >
            <Text>Main Content</Text>
          </AppShell>
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    const frame = lastFrame()
    expect(frame).toContain('MAIN')
    expect(frame).toContain('LEARNING')
    expect(frame).toContain('SYSTEM')
    expect(frame).toContain('Dashboard')
    expect(frame).toMatch(/Overview and\s+progress/)
    expect(frame).toContain('Main Content')
  })

  it('shows custom section titles when provided', async () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Sidebar
            items={sidebarItems}
            columns={120}
            sectionTitles={{
              main: 'HOME',
              learning: 'PRACTICE',
              system: 'TOOLS',
            }}
          />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    const frame = lastFrame()
    expect(frame).toContain('HOME')
    expect(frame).toContain('PRACTICE')
    expect(frame).toContain('TOOLS')
  })

  it('tracks the active navigation entry', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null

    function Harness() {
      nav = useNavigation()
      return <Sidebar items={sidebarItems} columns={120} />
    }

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Harness />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('› Dashboard')

    nav!.push('lessons')
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('› Lessons')
    expect(frame).not.toContain('› Dashboard')
  })

  it('supports arrow navigation and Enter activation', async () => {
    function CurrentScreen() {
      const { currentScreenId } = useNavigation()
      return <Text>Current: {currentScreenId}</Text>
    }

    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Box flexDirection="column">
            <Sidebar items={sidebarItems} columns={120} />
            <CurrentScreen />
          </Box>
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('Current: dashboard')

    stdin.write('\u001b[B')
    await delay()
    expect(lastFrame()).toContain('› Plan')
    expect(lastFrame()).toContain('• Dashboard')

    stdin.write('\r')
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Current: plan')
    expect(frame).toContain('› Plan')
  })

  it('click focuses and navigates to a bounded sidebar item', async () => {
    function CurrentScreen() {
      const { currentScreenId } = useNavigation()
      return <Text>Current: {currentScreenId}</Text>
    }

    const { lastFrame, stdin } = render(
      <FrameworkProvider registry={registry} defaultScreen="dashboard">
        <Sidebar
          items={sidebarItems}
          columns={120}
          mouseBoundsForItem={(item) =>
            item.id === 'plan'
              ? { x: 0, y: 2, width: 12, height: 1 }
              : undefined
          }
        />
        <CurrentScreen />
      </FrameworkProvider>,
    )

    await delay(100)
    stdin.write('\u001B[<0;1;3M')
    await delay()
    stdin.write('\u001B[<0;1;3m')
    await delay()

    expect(lastFrame()).toContain('Current: plan')
    expect(lastFrame()).toContain('› Plan')
  })

  it('automatically hit-tests sidebar rows and keeps keyboard focus there', async () => {
    function CurrentScreen() {
      const { currentScreenId } = useNavigation()
      return <Text>Current: {currentScreenId}</Text>
    }

    const { lastFrame, stdin } = render(
      <FrameworkProvider registry={registry} defaultScreen="dashboard">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Sidebar items={sidebarItems} columns={120} />
          <CurrentScreen />
        </MouseLayout>
      </FrameworkProvider>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Plan'))

    expect(lastFrame()).toContain('Current: plan')
    expect(lastFrame()).toContain('› Plan')
  })

  it('composes automatic footer targets through the measured sidebar path', async () => {
    const onActivate = vi.fn()
    const { lastFrame, stdin } = render(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <FrameworkProvider registry={registry} defaultScreen="dashboard">
          <Sidebar
            items={sidebarItems}
            columns={120}
            footer={<Button onActivate={onActivate}>Footer action</Button>}
          />
        </FrameworkProvider>
      </MouseLayout>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Footer action'))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('moves between the sidebar and content with Tab and horizontal arrows', async () => {
    function ContentItem() {
      const { focused } = useFocusable({ id: 'content-focus' })
      return <Text>Content item focused={String(focused)}</Text>
    }

    function FocusableContent() {
      const group = useFocusGroup('content-group', { scope: 'navigation' })
      return (
        <group.GroupProvider>
          <Text>Content group active={String(group.isActive)}</Text>
          <ContentItem />
        </group.GroupProvider>
      )
    }

    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <NavigationProvider registry={registry} defaultScreen="dashboard">
            <AppShell
              columns={120}
              sidebar={<Sidebar items={sidebarItems} columns={120} />}
            >
              <FocusableContent />
            </AppShell>
          </NavigationProvider>
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(lastFrame()).toContain('Content group active=false')

    stdin.write('\u001b[C')
    await delay()
    expect(lastFrame()).toContain('Content group active=true')

    stdin.write('\u001b[D')
    await delay()
    expect(lastFrame()).toContain('Content group active=false')

    stdin.write('\t')
    await delay()
    expect(lastFrame()).toContain('Content group active=true')
  })

  it('collapses descriptions below medium width while keeping labels visible', async () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Sidebar items={sidebarItems} columns={99} />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Dashboard')
    expect(frame).toContain('Plan')
    expect(frame).not.toContain('Overview and progress')
    expect(frame).not.toContain("Today's study plan")
  })
})
