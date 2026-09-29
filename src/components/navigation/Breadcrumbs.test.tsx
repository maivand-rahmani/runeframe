import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { NavigationProvider, useNavigation } from '../../navigation/NavigationProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { Breadcrumbs } from './Breadcrumbs.js'

function createTestRegistry() {
  const r = new ScreenRegistry()
  r.register({
    id: 'dashboard',
    title: 'Dashboard',
    component: () => <Text>Dash</Text>,
    category: 'main',
    sidebar: true,
  })
  r.register({
    id: 'lessons',
    title: 'Lessons',
    component: () => <Text>Lessons</Text>,
    category: 'learning',
    sidebar: true,
  })
  r.register({
    id: 'lessonDetail',
    title: 'Present Perfect',
    component: () => <Text>Detail</Text>,
    category: 'learning',
    sidebar: false,
  })
  r.register({
    id: 'speak',
    title: 'Speaking',
    component: () => <Text>Speak</Text>,
    category: 'learning',
    sidebar: true,
  })
  r.register({
    id: 'config',
    title: 'Settings',
    component: () => <Text>Config</Text>,
    category: 'system',
    sidebar: false,
  })
  return r
}

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
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
  await pressCell(stdin, cell)
  await releaseCell(stdin, cell)
}

async function pressCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}M`)
  await new Promise((resolve) => setTimeout(resolve, 40))
}

async function releaseCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}m`)
  await new Promise((resolve) => setTimeout(resolve, 40))
}

describe('Breadcrumbs', () => {
  let registry: ScreenRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('renders single breadcrumb at root', () => {
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Breadcrumbs />
      </NavigationProvider>,
    )
    expect(lastFrame()).toContain('Dashboard')
  })

  it('renders breadcrumbs from navigation history', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    expect(lastFrame()).toContain('Dashboard')

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Dashboard')
    expect(lastFrame()).toContain('Lessons')

    nav!.push('lessonDetail')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Dashboard')
    expect(lastFrame()).toContain('Lessons')
    expect(lastFrame()).toContain('Present Perfect')
  })

  it('shows separator between breadcrumb items', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    const frame = lastFrame()
    expect(frame).toContain('>')
    expect(frame).toMatch(/Dashboard\s*>\s*Lessons/)
  })

  it('highlights current (last) segment as active', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    expect(lastFrame()).toContain('Dashboard')

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Dashboard')
    expect(lastFrame()).toContain('Lessons')
  })

  it('fires onSelect with screenId when segment clicked', async () => {
    const selections: string[] = []
    let nav: ReturnType<typeof useNavigation> | null = null

    function Harness() {
      nav = useNavigation()
      return (
        <Breadcrumbs
          onSelect={(id) => {
            selections.push(id)
          }}
        />
      )
    }

    renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    const { breadcrumbs } = nav!
    expect(breadcrumbs.length).toBe(1)
    expect(breadcrumbs[0].screenId).toBe('dashboard')
  })

  it('renders a specific onSelect is passed as function', () => {
    let capturedOnSelect: string | null = null
    function Harness() {
      return (
        <Breadcrumbs
          onSelect={(id) => {
            capturedOnSelect = id
          }}
        />
      )
    }
    renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )
    expect(capturedOnSelect).toBeNull()
  })

  it('uses custom separator', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs separator=" / " />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toMatch(/Dashboard\s*\/\s*Lessons/)
  })

  it('truncates overflow with maxItems', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs maxItems={3} />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    nav!.push('lessonDetail')
    await new Promise((r) => setTimeout(r, 20))
    nav!.push('speak')
    await new Promise((r) => setTimeout(r, 20))

    const frame = lastFrame()
    expect(frame).toContain('Dashboard')
    expect(frame).toContain('Speaking')
    expect(frame).toContain('...')
  })

  it('does not truncate when within maxItems', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs maxItems={5} />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    nav!.push('lessonDetail')
    await new Promise((r) => setTimeout(r, 20))

    const frame = lastFrame()
    expect(frame).toContain('Dashboard')
    expect(frame).toContain('Lessons')
    expect(frame).toContain('Present Perfect')
    expect(frame).not.toContain('...')
  })

  it('updates when navigation stack changes', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return <Breadcrumbs />
    }
    const { lastFrame } = renderInTheme(
      <NavigationProvider registry={registry} defaultScreen="dashboard">
        <Harness />
      </NavigationProvider>,
    )

    expect(lastFrame()).toContain('Dashboard')

    nav!.push('lessons')
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Lessons')

    nav!.pop()
    await new Promise((r) => setTimeout(r, 20))
    expect(lastFrame()).toContain('Dashboard')
    expect(lastFrame()).not.toContain('Lessons')
  })

  it('automatically hit-tests prior breadcrumb segments', async () => {
    const selections: string[] = []
    function Harness() {
      const nav = useNavigation()
      useEffect(() => {
        nav.push('lessons')
      }, [nav.push])
      return <Breadcrumbs onSelect={(id) => selections.push(id)} />
    }

    const { lastFrame, stdin } = render(
      <FrameworkProvider registry={registry} defaultScreen="dashboard">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Harness />
        </MouseLayout>
      </FrameworkProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(lastFrame()).toContain('Dashboard')
    expect(lastFrame()).toContain('Lessons')
    await clickCell(stdin, cellInFrame(lastFrame(), 'Dashboard'))

    expect(selections).toEqual(['dashboard'])
  })

  it('uses the latest committed onSelect callback for mouse activation', async () => {
    const selections: string[] = []
    let updateCallback = () => {}
    function Harness() {
      const nav = useNavigation()
      const [revision, setRevision] = useState(0)
      updateCallback = () => setRevision(1)
      useEffect(() => {
        nav.push('lessons')
      }, [nav.push])
      return (
        <Breadcrumbs
          onSelect={(id) => selections.push(`${revision}:${id}`)}
        />
      )
    }

    const { lastFrame, stdin } = render(
      <FrameworkProvider registry={registry} defaultScreen="dashboard">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Harness />
        </MouseLayout>
      </FrameworkProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 120))
    updateCallback()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await clickCell(stdin, cellInFrame(lastFrame(), 'Dashboard'))

    expect(selections).toEqual(['1:dashboard'])
  })

  it('resolves a breadcrumb again after the trail changes during a press', async () => {
    const selections: string[] = []
    let extendTrail = () => {}
    function Harness() {
      const nav = useNavigation()
      const [extended, setExtended] = useState(false)
      extendTrail = () => setExtended(true)
      useEffect(() => {
        nav.push('lessons')
        nav.push('lessonDetail')
      }, [nav.push])
      useEffect(() => {
        if (extended) nav.push('speak')
      }, [extended, nav.push])
      return <Breadcrumbs onSelect={(id) => selections.push(id)} />
    }

    const { lastFrame, stdin } = render(
      <FrameworkProvider registry={registry} defaultScreen="dashboard">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Harness />
        </MouseLayout>
      </FrameworkProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 120))
    const lessonsCell = cellInFrame(lastFrame(), 'Lessons')
    await pressCell(stdin, lessonsCell)
    extendTrail()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await releaseCell(stdin, lessonsCell)

    expect(selections).toEqual(['lessons'])
  })
})
