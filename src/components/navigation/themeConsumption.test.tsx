import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import chalk from 'chalk'
import { Box, Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import {
  NavigationProvider,
  useNavigation,
} from '../../navigation/NavigationProvider.js'
import type { ThemeOverrides } from '../../types.js'
import { Breadcrumbs } from './Breadcrumbs.js'
import { Sidebar, type SidebarItem } from './Sidebar.js'
import { Tabs } from './Tabs.js'

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
  return registry
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', category: 'main' },
  { id: 'plan', label: 'Plan', category: 'main' },
  { id: 'lessons', label: 'Lessons', category: 'learning' },
]

function renderNavigation(ui: ReactElement, theme?: ThemeOverrides) {
  return render(
    <ThemeProvider theme={theme}>
      <KeyboardScopeProvider>
        <NavigationProvider
          registry={createTestRegistry()}
          defaultScreen="dashboard"
        >
          {ui}
        </NavigationProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>,
  )
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

async function waitForFrame(
  app: { lastFrame: () => string | undefined },
  check: (frame: string) => void,
) {
  await vi.waitFor(() => {
    check(plain(app.lastFrame()))
  })
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

describe('navigation theme consumption', () => {
  it('keeps the default Tabs separator without a theme', () => {
    const { lastFrame } = renderNavigation(
      <Tabs
        tabs={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        activeTabId="a"
        onChange={() => {}}
      />,
    )

    expect(plain(lastFrame())).toContain('Alpha | Beta')
  })

  it('consumes the global Tabs separator symbol', () => {
    const { lastFrame } = renderNavigation(
      <Tabs
        tabs={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        activeTabId="a"
        onChange={() => {}}
      />,
      { symbols: { tabs: { separator: '::' } } },
    )

    expect(plain(lastFrame())).toContain('Alpha :: Beta')
  })

  it('prefers the per-component Tabs separator over the global symbol', () => {
    const { lastFrame } = renderNavigation(
      <Tabs
        tabs={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        activeTabId="a"
        onChange={() => {}}
      />,
      {
        symbols: { tabs: { separator: '::' } },
        components: { tabs: { symbols: { separator: '~' } } },
      },
    )

    expect(plain(lastFrame())).toContain('Alpha ~ Beta')
  })

  it('keeps default Sidebar markers without a theme', async () => {
    const app = renderNavigation(<Sidebar items={sidebarItems} columns={120} />)

    await waitForFrame(app, (frame) => {
      expect(frame).toContain('\u203a Dashboard')
    })
  })

  it('consumes global Sidebar markers', async () => {
    const app = renderNavigation(
      <Box flexDirection="column">
        <Sidebar items={sidebarItems} columns={120} />
      </Box>,
      { symbols: { sidebar: { active: '*', item: '+' } } },
    )

    await waitForFrame(app, (frame) => {
      expect(frame).toContain('* Dashboard')
    })

    app.stdin.write('\u001b[B')
    await waitForFrame(app, (frame) => {
      expect(frame).toContain('* Plan')
      expect(frame).toContain('+ Dashboard')
    })
  })

  it('prefers per-component Sidebar symbols over global symbols', async () => {
    const app = renderNavigation(
      <Sidebar items={sidebarItems} columns={120} />,
      {
        symbols: { sidebar: { active: '*', item: '+' } },
        components: { sidebar: { symbols: { active: '@' } } },
      },
    )

    await waitForFrame(app, (frame) => {
      expect(frame).toContain('@ Dashboard')
    })
  })

  it('consumes per-component Breadcrumbs separator symbols', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }

    const app = renderNavigation(<Harness />, {
      components: { breadcrumbs: { symbols: { separator: ' / ' } } },
    })

    nav!.push('lessons')
    await waitForFrame(app, (frame) => {
      expect(frame).toContain('Dashboard / Lessons')
    })
  })

  it('consumes per-component Breadcrumbs colors', async () => {
    chalk.level = 1
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }

    const app = renderNavigation(<Harness />, {
      components: { breadcrumbs: { colors: { current: 'magenta' } } },
    })

    nav!.push('lessons')
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain('\u001B[35m')
    })
  })
})
