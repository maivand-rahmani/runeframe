import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { useEffect, type ReactNode } from 'react'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { useKeyboardScope } from '../interaction/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../commands/ScopedActionRegistryProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { ChoicePrompt, type ChoiceItem } from './ChoicePrompt.js'

function renderInTheme(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <KeyboardScopeProvider defaultScope="list">
        <ScopedActionRegistryProvider>{ui}</ScopedActionRegistryProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>,
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
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<0;${x};${y}M`)
  await delay()
  stdin.write(`\u001B[<0;${x};${y}m`)
  await delay()
}

function ListScope({ children }: { children: ReactNode }) {
  const keyboardScope = useKeyboardScope()
  useEffect(() => {
    keyboardScope.pushScope('list')
    return () => keyboardScope.popScope('list')
  }, [keyboardScope.pushScope, keyboardScope.popScope])
  return children
}

const interactionRegistry = new ScreenRegistry()
interactionRegistry.register({ id: 'test', title: 'Test', component: () => null })

type StrItem = ChoiceItem<string>

const sampleItems: StrItem[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
]

const itemsWithDesc: StrItem[] = [
  { value: 'x', label: 'Option X', description: 'First option' },
  { value: 'y', label: 'Option Y', description: 'Second option' },
]

const itemsWithDisabled: StrItem[] = [
  { value: 'a', label: 'Enabled A' },
  { value: 'b', label: 'Disabled B', disabled: true },
  { value: 'c', label: 'Enabled C' },
]

describe('ChoicePrompt', () => {
  it('renders all items with letter prefixes', () => {
    const { lastFrame } = renderInTheme(
      <ChoicePrompt items={sampleItems} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('a)')
    expect(frame).toContain('b)')
    expect(frame).toContain('c)')
    expect(frame).toContain('Alpha')
    expect(frame).toContain('Beta')
    expect(frame).toContain('Gamma')
  })

  it('renders label when provided', () => {
    const { lastFrame } = renderInTheme(
      <ChoicePrompt items={sampleItems} onSelect={() => {}} label="Pick one" />,
    )
    expect(lastFrame()).toContain('Pick one')
  })

  it('renders descriptions when provided', () => {
    const { lastFrame } = renderInTheme(
      <ChoicePrompt items={itemsWithDesc} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('First option')
    expect(frame).toContain('Second option')
  })

  it('renders disabled items dimmed', () => {
    const { lastFrame } = renderInTheme(
      <ChoicePrompt items={itemsWithDisabled} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Enabled A')
    expect(frame).toContain('Disabled B')
    expect(frame).toContain('Enabled C')
  })

  it('renders empty state without crashing', () => {
    const { lastFrame } = renderInTheme(
      <ChoicePrompt items={[]} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('No options')
  })

  it('selects item on letter key press', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={sampleItems}
        onSelect={(item) => selected.push(item.value)}
      />,
    )
    await delay()
    stdin.write('b')
    await delay()
    expect(selected).toContain('beta')
  })

  it('selects item via arrow and enter', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={sampleItems}
        onSelect={(item) => selected.push(item.value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // arrow down
    await delay()
    stdin.write('\r') // enter
    await delay()
    expect(selected).toContain('beta')
  })

  it('calls onCancel on Escape', async () => {
    let cancelled = false
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={sampleItems}
        onSelect={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    await delay()
    stdin.write('\u001b') // escape
    await delay()
    expect(cancelled).toBe(true)
  })

  it('skips disabled items in navigation', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={itemsWithDisabled}
        onSelect={(item) => selected.push(item.value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // arrow down — skip disabled B, land on C
    await delay()
    stdin.write('\r') // enter
    await delay()
    expect(selected).toContain('c')
  })

  it('does not select disabled item via letter shortcut', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={itemsWithDisabled}
        onSelect={(item) => selected.push(item.value)}
      />,
    )
    await delay()
    stdin.write('b') // should not select disabled item
    await delay()
    expect(selected).toHaveLength(0)
  })

  it('navigates up with arrow up', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ChoicePrompt
        items={sampleItems}
        onSelect={(item) => selected.push(item.value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down to beta
    await delay()
    stdin.write('\u001b[B') // down to gamma
    await delay()
    stdin.write('\u001b[A') // up back to beta
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('beta')
  })

  it('automatically hit-tests choices, consumes disabled rows, and focuses clicks', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <ListScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <ChoicePrompt
              items={itemsWithDisabled}
              onSelect={(item) => selected.push(item.value)}
            />
          </MouseLayout>
        </ListScope>
      </FrameworkProvider>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Disabled B'))
    expect(selected).toEqual([])

    await clickCell(stdin, cellInFrame(lastFrame(), 'Enabled C'))
    expect(selected).toEqual(['c'])

    stdin.write('\u001B[A')
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['c', 'a'])
  })
})
