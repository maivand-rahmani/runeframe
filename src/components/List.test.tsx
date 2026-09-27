import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { FocusTreeProvider } from '../interaction/FocusTreeProvider.js'
import { List, type ListItem } from './List.js'
import type { ReactElement } from 'react'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForFrame(
  getFrame: () => string | undefined,
  expected: string,
  timeoutMs = 1500,
): Promise<string> {
  const start = Date.now()
  let frame = getFrame() ?? ''
  while (Date.now() - start < timeoutMs) {
    if (frame.includes(expected)) return frame
    await delay(20)
    frame = getFrame() ?? ''
  }
  return frame
}

const sampleItems: ListItem[] = [
  { id: 'a', label: 'Item Alpha', description: 'First description' },
  { id: 'b', label: 'Item Beta' },
  { id: 'c', label: 'Item Gamma', description: 'Third description' },
]

describe('List', () => {
  it('renders all items with labels', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Item Alpha')
    expect(frame).toContain('Item Beta')
    expect(frame).toContain('Item Gamma')
  })

  it('renders descriptions when provided', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('First description')
    expect(frame).toContain('Third description')
  })

  it('marks selected item with bullet', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} selectedId="b" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('•')
  })

  it('autoFocuses first item and fires onActivate on Enter', async () => {
    const activated: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} onActivate={(id) => activated.push(id)} />
      </KeyboardScopeProvider>,
    )

    // First delay lets autoFocus useEffect commit
    await delay(100)
    // Second stdin.write happens in a separate macrotask so React
    // has a chance to incorporate the autoFocused state
    await delay(30)
    stdin.write('\r')
    await delay()
    expect(activated).toContain('a')
  })

  it('moves focus with arrow down and activates correct item', async () => {
    const activated: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} onActivate={(id) => activated.push(id)} />
      </KeyboardScopeProvider>,
    )

    await delay()
    stdin.write('\u001b[B')
    await delay()
    stdin.write('\r')
    await delay()
    expect(activated).toContain('b')
  })

  it('navigates under FocusTreeProvider without legacy focus providers', async () => {
    const activated: string[] = []
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="navigation">
        <FocusTreeProvider>
          <List
            items={sampleItems}
            onActivate={(id) => activated.push(id)}
            renderItem={(item, { focused }) => (
              <Text>
                {item.label}
                {focused ? '*' : ''}
              </Text>
            )}
          />
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await waitForFrame(lastFrame, 'Item Alpha*')

    stdin.write('\u001b[B')
    await waitForFrame(lastFrame, 'Item Beta*')

    stdin.write('\r')
    await delay()
    expect(activated).toContain('b')
  })

  it('moves focus with multiple arrow downs and activates correctly', async () => {
    const activated: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} onActivate={(id) => activated.push(id)} />
      </KeyboardScopeProvider>,
    )

    await delay()
    stdin.write('\u001b[B')
    await delay()
    stdin.write('\u001b[B')
    await delay()
    stdin.write('\r')
    await delay()
    expect(activated).toContain('c')
  })

  it('calls onSelect when focus moves to a different item', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} onSelect={(id) => selected.push(id)} />
      </KeyboardScopeProvider>,
    )

    await delay()
    expect(selected).toHaveLength(0)

    stdin.write('\u001b[B')
    await delay()
    expect(selected).toContain('b')
    expect(selected).toHaveLength(1)
  })

  it('calls onSelect for each arrow navigation', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems} onSelect={(id) => selected.push(id)} />
      </KeyboardScopeProvider>,
    )

    await delay()
    stdin.write('\u001b[B')
    await delay()
    stdin.write('\u001b[B')
    await delay()
    expect(selected).toContain('b')
    expect(selected).toContain('c')
    expect(selected).toHaveLength(2)
  })

  it('clips items beyond maxVisible', () => {
    const manyItems: ListItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
    }))

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={manyItems} maxVisible={3} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Item 0')
    expect(frame).toContain('Item 1')
    expect(frame).toContain('Item 2')
    expect(frame).not.toContain('Item 3')
    expect(frame).not.toContain('Item 9')
  })

  it('renders empty state without crashing', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={[]} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('No items')
  })

  it('supports custom renderItem', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List
          items={sampleItems}
          selectedId="b"
          renderItem={(item, { focused, selected }) => (
            <Text>
              {item.label} (f:{String(focused)} s:{String(selected)})
            </Text>
          )}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('(f:false s:true)')
  })
})
