import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { FocusTreeProvider } from '../../interaction/focus/FocusTreeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { List, type ListItem } from './List.js'
import type { ReactElement } from 'react'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const interactionRegistry = new ScreenRegistry()
interactionRegistry.register({ id: 'test', title: 'Test', component: () => null })

function renderInFramework(ui: ReactElement) {
  return render(
    <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>,
  )
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

async function wheelAtCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
  direction: 'up' | 'down',
) {
  const button = direction === 'up' ? 64 : 65
  stdin.write(`\u001B[<${button};${cell.x + 1};${cell.y + 1}M`)
  await delay()
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

  it('bounded row clicks focus and select without activating the row', async () => {
    const selected: string[] = []
    const activated: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <List
        items={sampleItems}
        onSelect={(id) => selected.push(id)}
        onActivate={(id) => activated.push(id)}
        mouseBoundsForItem={(_item, index) => ({
          x: 0,
          y: index,
          width: 12,
          height: 1,
        })}
        renderItem={(item, { focused }) => (
          <Text>
            {item.label}
            {focused ? '*' : ''}
          </Text>
        )}
      />,
    )

    await delay(100)
    stdin.write('\u001B[<0;2;2M')
    await delay()
    stdin.write('\u001B[<0;2;2m')
    await delay()

    expect(lastFrame()).toContain('Item Beta*')
    expect(selected).toEqual(['b'])
    expect(activated).toHaveLength(0)
  })

  it('automatically hit-tests visible rows and preserves select-only click semantics', async () => {
    const selected: string[] = []
    const activated: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <List
          items={sampleItems}
          onSelect={(id) => selected.push(id)}
          onActivate={(id) => activated.push(id)}
          renderItem={(item, { focused }) => (
            <Text>
              {item.label}
              {focused ? '*' : ''}
            </Text>
          )}
        />
      </MouseLayout>,
    )

    await delay(100)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Item Beta'))

    expect(lastFrame()).toContain('Item Beta*')
    expect(selected).toEqual(['b'])
    expect(activated).toHaveLength(0)

    stdin.write('\u001B[B')
    await delay()
    expect(lastFrame()).toContain('Item Gamma*')
  })

  it('keeps explicit row bounds authoritative beneath MouseLayout', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <List
          items={sampleItems}
          onSelect={(id) => selected.push(id)}
          mouseBoundsForItem={(item) =>
            item.id === 'a' ? { x: 0, y: 0, width: 8, height: 1 } : undefined
          }
        />
      </MouseLayout>,
    )

    await delay(100)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Item Beta'))
    expect(selected).toEqual([])

    await clickCell(stdin, { x: 0, y: 0 })
    expect(selected).toEqual(['a'])
  })

  it('cancels an automatic row press when reordering moves another row under it', async () => {
    const selected: string[] = []
    const orderedItems = [sampleItems[1], sampleItems[0], sampleItems[2]]
    const view = (items: ListItem[]) => (
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <List
            items={items}
            onSelect={(id) => selected.push(id)}
            renderItem={(item) => <Text>{item.label}</Text>}
          />
        </MouseLayout>
      </FrameworkProvider>
    )
    const { stdin, lastFrame, rerender } = render(view(sampleItems))

    await delay(100)
    const originalCell = cellInFrame(lastFrame(), 'Item Alpha')
    stdin.write(`\u001B[<0;${originalCell.x + 1};${originalCell.y + 1}M`)
    await delay()
    rerender(view(orderedItems))
    await delay(100)
    stdin.write(`\u001B[<0;${originalCell.x + 1};${originalCell.y + 1}m`)
    await delay()

    expect(selected).toEqual([])
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

  it('wheel-scrolls one item at a time, bubbles at its bounds, and never selects or activates', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `wheel-${index}`,
      label: `Wheel item ${index}`,
    }))
    const selected: string[] = []
    const activated: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={50}
        height={12}
        flexDirection="column"
      >
        <List
          items={items}
          maxVisible={2}
          onSelect={(id) => selected.push(id)}
          onActivate={(id) => activated.push(id)}
          renderItem={(item, { focused }) => (
            <Text>
              {item.label}
              {focused ? '*' : ''}
            </Text>
          )}
        />
      </MouseLayout>,
    )
    await delay(120)

    const firstCell = cellInFrame(lastFrame(), 'Wheel item 0')
    await wheelAtCell(stdin, firstCell, 'up')
    expect(lastFrame()).toContain('Wheel item 0')

    await wheelAtCell(stdin, firstCell, 'down')
    expect(lastFrame()).not.toContain('Wheel item 0')
    expect(lastFrame()).toContain('Wheel item 1')
    expect(lastFrame()).toContain('Wheel item 2')

    await wheelAtCell(stdin, firstCell, 'up')
    expect(lastFrame()).toContain('Wheel item 0')

    // Reach the bottom, then confirm the List reports no movement there.
    for (let index = 0; index < 5; index++) {
      await wheelAtCell(stdin, firstCell, 'down')
    }
    expect(lastFrame()).toContain('Wheel item 4')
    const bottomFrame = lastFrame()
    await wheelAtCell(stdin, firstCell, 'down')
    expect(lastFrame()).toBe(bottomFrame)

    // A row that is not in the visible slice has no mounted automatic target.
    await clickCell(stdin, { x: 1, y: 2 })
    expect(selected).toEqual([])
    expect(activated).toEqual([])
  })

  it('keeps keyboard-focused rows visible and clamps when items or maxVisible shrink', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `focus-${index}`,
      label: `Focus item ${index}`,
    }))
    const view = (visible: number, currentItems: ListItem[]) => (
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <MouseLayout
          origin={{ x: 0, y: 0 }}
          width={50}
          height={12}
          flexDirection="column"
        >
          <List
            items={currentItems}
            maxVisible={visible}
            renderItem={(item, { focused }) => (
              <Text>
                {item.label}
                {focused ? '*' : ''}
              </Text>
            )}
          />
        </MouseLayout>
      </FrameworkProvider>
    )
    const { stdin, lastFrame, rerender } = render(view(2, items))
    await delay(120)

    stdin.write('\u001B[B')
    await delay()
    stdin.write('\u001B[B')
    await delay()
    expect(lastFrame()).toContain('Focus item 2*')
    expect(lastFrame()).toContain('Focus item 1')
    expect(lastFrame()).not.toContain('Focus item 0')

    stdin.write('\u001B[A')
    await delay()
    expect(lastFrame()).toContain('Focus item 1*')

    // Reducing the item count clamps the old offset back to the only valid
    // window; reducing maxVisible also keeps the focused row in view.
    rerender(view(2, items.slice(0, 2)))
    await delay()
    expect(lastFrame()).toContain('Focus item 0')
    expect(lastFrame()).toContain('Focus item 1')
    expect(lastFrame()).not.toContain('Focus item 2')

    rerender(view(1, items.slice(0, 2)))
    await delay()
    expect(lastFrame()).toContain('Focus item 1*')
    expect(lastFrame()).not.toContain('Focus item 0')
  })

  it('does not add blank rows for content shorter than maxVisible', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <List items={sampleItems.slice(0, 2)} maxVisible={5} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Item Alpha')
    expect(frame).toContain('Item Beta')
    expect(frame).not.toContain('Item Gamma')
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
