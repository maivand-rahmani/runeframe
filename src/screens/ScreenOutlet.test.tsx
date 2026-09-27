import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { ScreenRegistry } from './registry.js'
import {
  NavigationProvider,
  useNavigation,
} from '../navigation/NavigationProvider.js'
import { ScreenOutlet } from './ScreenOutlet.js'

function createTestRegistry() {
  const r = new ScreenRegistry()
  r.register({
    id: 'dashboard',
    title: 'Dashboard',
    component: () => <Text>Dashboard Screen</Text>,
    category: 'main',
    sidebar: true,
  })
  r.register({
    id: 'lessons',
    title: 'Lessons',
    component: () => <Text>Lessons Screen</Text>,
    category: 'learning',
    sidebar: true,
  })
  r.register({
    id: 'detail',
    title: 'Detail',
    component: ({ params }) => <Text>Detail:{String(params.id)}</Text>,
    category: 'system',
    sidebar: false,
  })
  return r
}

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('ScreenOutlet', () => {
  let registry: ScreenRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('renders the current route component without a ScreenProvider', () => {
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <ScreenOutlet />
      </NavigationProvider>,
    )
    expect(lastFrame()).toContain('Dashboard Screen')
  })

  it('renders a different defaultScreen', () => {
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="lessons">
        <ScreenOutlet />
      </NavigationProvider>,
    )
    expect(lastFrame()).toContain('Lessons Screen')
  })

  it('follows route pushes and pops', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Capture() {
      nav = useNavigation()
      return <ScreenOutlet />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Capture />
      </NavigationProvider>,
    )
    expect(lastFrame()).toContain('Dashboard Screen')

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Lessons Screen')

    nav!.pop()
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Dashboard Screen')
  })

  it('passes route params to the screen component', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Capture() {
      nav = useNavigation()
      return <ScreenOutlet />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Capture />
      </NavigationProvider>,
    )

    nav!.push('detail', { id: 42 })
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Detail:42')
  })
})
