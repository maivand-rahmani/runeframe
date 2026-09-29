import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { useEffect, useState, type ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useKeyboardScope } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { Tabs, type Tab } from './Tabs.js'

function renderInTheme(ui: ReactElement) {
  return render(
    <KeyboardScopeProvider defaultScope="list">
      <ThemeProvider>{ui}</ThemeProvider>
    </KeyboardScopeProvider>,
  )
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
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
  await delay()
}

async function releaseCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}m`)
  await delay()
}

const tabRegistry = new ScreenRegistry()
tabRegistry.register({ id: 'test', title: 'Test', component: () => null })

describe('Tabs', () => {
  const sampleTabs: Tab[] = [
    { id: 'grammar', label: 'Grammar' },
    { id: 'vocab', label: 'Vocabulary' },
    { id: 'speaking', label: 'Speaking' },
  ]

  it('renders all tabs with labels', () => {
    const { lastFrame } = renderInTheme(
      <Tabs tabs={sampleTabs} activeTabId="grammar" onChange={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Grammar')
    expect(frame).toContain('Vocabulary')
    expect(frame).toContain('Speaking')
  })

  it('shows separator between tabs', () => {
    const { lastFrame } = renderInTheme(
      <Tabs tabs={sampleTabs} activeTabId="grammar" onChange={() => {}} />,
    )
    expect(lastFrame()).toMatch(/Grammar\s*\|\s*Vocabulary/)
  })

  it('renders nothing for empty tabs array', () => {
    const { lastFrame } = renderInTheme(
      <Tabs tabs={[]} activeTabId="" onChange={() => {}} />,
    )
    expect(lastFrame()).toBe('')
  })

  it('right arrow moves to next tab', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <Tabs
        tabs={sampleTabs}
        activeTabId="grammar"
        onChange={(id) => changes.push(id)}
      />,
    )

    stdin.write('\u001b[C')
    await delay()
    expect(changes).toEqual(['vocab'])
  })

  it('left arrow moves to previous tab', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <Tabs
        tabs={sampleTabs}
        activeTabId="vocab"
        onChange={(id) => changes.push(id)}
      />,
    )

    stdin.write('\u001b[D')
    await delay()
    expect(changes).toEqual(['grammar'])
  })

  it('wraps around from first to last on left arrow', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <Tabs
        tabs={sampleTabs}
        activeTabId="grammar"
        onChange={(id) => changes.push(id)}
      />,
    )

    stdin.write('\u001b[D')
    await delay()
    expect(changes).toEqual(['speaking'])
  })

  it('wraps around from last to first on right arrow', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <Tabs
        tabs={sampleTabs}
        activeTabId="speaking"
        onChange={(id) => changes.push(id)}
      />,
    )

    stdin.write('\u001b[C')
    await delay()
    expect(changes).toEqual(['grammar'])
  })

  it('cycles through tabs with stateful wrapper', async () => {
    const changeLog: string[] = []

    function Harness() {
      const [activeId, setActiveId] = useState('grammar')
      return (
        <Tabs
          tabs={sampleTabs}
          activeTabId={activeId}
          onChange={(id) => {
            changeLog.push(id)
            setActiveId(id)
          }}
        />
      )
    }

    const { stdin } = renderInTheme(<Harness />)
    await delay()

    stdin.write('\u001b[C')
    await delay()

    stdin.write('\u001b[C')
    await delay()

    expect(changeLog).toEqual(['vocab', 'speaking'])
  })

  it('one key writes all onChange in single chunk when no state update between', () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <Tabs
        tabs={sampleTabs}
        activeTabId="grammar"
        onChange={(id) => changes.push(id)}
      />,
    )

    // All arrow keys written as a single stdin chunk.  Since the
    // test driver processes the entire chunk before React commits
    // any state update, all three right-arrow handlers see
    // activeTabId="grammar" and call onChange("vocab"); the final
    // left arrow sees "grammar" and calls onChange("speaking").
    stdin.write('\u001b[C\u001b[C\u001b[C\u001b[D')

    expect(changes).toEqual(['vocab', 'vocab', 'vocab', 'speaking'])
  })

  it('click selects a tab and subsequent arrows use the clicked tab', async () => {
    const changes: string[] = []
    function Harness() {
      const [activeId, setActiveId] = useState('grammar')
      const keyboardScope = useKeyboardScope()
      useEffect(() => {
        keyboardScope.pushScope('list')
        return () => keyboardScope.popScope('list')
      }, [keyboardScope.pushScope, keyboardScope.popScope])

      return (
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Tabs
            tabs={sampleTabs}
            activeTabId={activeId}
            onChange={(id) => {
              changes.push(id)
              setActiveId(id)
            }}
          />
        </MouseLayout>
      )
    }

    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={tabRegistry} defaultScreen="test">
        <Harness />
      </FrameworkProvider>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Vocabulary'))
    expect(changes).toEqual(['vocab'])

    stdin.write('\u001B[C')
    await delay()
    expect(changes).toEqual(['vocab', 'speaking'])
  })

  it('uses the latest committed onChange callback for mouse activation', async () => {
    const changes: string[] = []
    let updateCallback = () => {}
    function Harness() {
      const [revision, setRevision] = useState(0)
      updateCallback = () => setRevision(1)
      return (
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Tabs
            tabs={sampleTabs}
            activeTabId="grammar"
            onChange={(id) => changes.push(`${revision}:${id}`)}
          />
        </MouseLayout>
      )
    }

    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={tabRegistry} defaultScreen="test">
        <Harness />
      </FrameworkProvider>,
    )

    await delay(120)
    updateCallback()
    await delay(80)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Vocabulary'))

    expect(changes).toEqual(['1:vocab'])
  })

  it('does not release a pressed tab onto a different tab after reorder', async () => {
    const changes: string[] = []
    let reverseTabs = () => {}
    function Harness() {
      const [reversed, setReversed] = useState(false)
      reverseTabs = () => setReversed(true)
      return (
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <Tabs
            tabs={reversed ? [...sampleTabs].reverse() : sampleTabs}
            activeTabId="grammar"
            onChange={(id) => changes.push(id)}
          />
        </MouseLayout>
      )
    }

    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={tabRegistry} defaultScreen="test">
        <Harness />
      </FrameworkProvider>,
    )

    await delay(120)
    const firstTabCell = cellInFrame(lastFrame(), 'Grammar')
    await pressCell(stdin, firstTabCell)
    reverseTabs()
    await delay(80)
    await releaseCell(stdin, firstTabCell)

    expect(changes).toEqual([])

    await clickCell(stdin, cellInFrame(lastFrame(), 'Speaking'))
    expect(changes).toEqual(['speaking'])
  })

  it('truncates long labels', () => {
    const longTabs: Tab[] = [
      {
        id: 'a',
        label:
          'This is an extremely long grammar tab label that should definitely be truncated in any reasonable terminal width',
      },
      {
        id: 'b',
        label:
          'This vocabulary section label is also very long and should be truncated to fit the available space',
      },
    ]
    const { lastFrame } = renderInTheme(
      <Tabs tabs={longTabs} activeTabId="a" onChange={() => {}} />,
    )

    const frame = lastFrame()
    expect(frame).toBeTruthy()
    expect(frame).not.toContain(
      'This vocabulary section label is also very long and should be truncated',
    )
  })
})
