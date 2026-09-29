import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { SelectableList } from './SelectableList.js'
import type { ReactElement } from 'react'
import type { ListItem } from './List.js'

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

async function wheelCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  stdin.write(`\u001B[<65;${cell.x + 1};${cell.y + 1}M`)
  await delay()
}

const sampleItems: ListItem[] = [
  { id: 'a', label: 'Apple', description: 'Fruit' },
  { id: 'b', label: 'Banana', description: 'Yellow fruit' },
  { id: 'c', label: 'Carrot', description: 'Vegetable' },
]

describe('SelectableList', () => {
  it('renders all items when no filter', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList items={sampleItems} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Apple')
    expect(frame).toContain('Banana')
    expect(frame).toContain('Carrot')
  })

  it('filters items by query matching label', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList items={sampleItems} filterQuery="app" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Apple')
    expect(frame).not.toContain('Banana')
    expect(frame).not.toContain('Carrot')
  })

  it('filters items case-insensitively', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList items={sampleItems} filterQuery="APP" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Apple')
  })

  it('filters items by id', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList items={sampleItems} filterQuery="c" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Carrot')
    expect(frame).not.toContain('Apple')
    expect(frame).not.toContain('Banana')
  })

  it('shows no-results message when filter matches nothing', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList
          items={sampleItems}
          filterQuery="xyznonexistent"
        />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('No results')
  })

  it('supports custom filterFn that returns boolean', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList
          items={sampleItems}
          filterQuery="custom-filter"
          filterFn={(item) => item.label.length > 5}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    // Apple (5) is not > 5, Banana (6) > 5, Carrot (6) > 5
    expect(frame).not.toContain('Apple')
    expect(frame).toContain('Banana')
    expect(frame).toContain('Carrot')
  })

  it('passes selectedId through to List', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList items={sampleItems} selectedId="b" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('•')
  })

  it('passes custom renderItem to List', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList
          items={sampleItems}
          renderItem={(item, { focused, selected }) => (
            <Text>
              {item.label} f={String(focused)} s={String(selected)}
            </Text>
          )}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('f=')
    expect(frame).toContain('s=')
  })

  it('onActivate fires when Enter pressed on filtered item', async () => {
    const activated: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="list">
        <SelectableList
          items={sampleItems}
          filterQuery="banana"
          onActivate={(id) => activated.push(id)}
        />
      </KeyboardScopeProvider>,
    )

    // Wait for autoFocus to settle through the filter + List render cycle
    await delay(200)
    stdin.write('\r')
    await delay(100)
    expect(activated).toContain('b')
  })

  it('resolves mouse bounds against displayed filtered rows', async () => {
    const selected: string[] = []
    const { stdin } = renderInFramework(
      <SelectableList
        items={sampleItems}
        filterQuery="Banana"
        onSelect={(id) => selected.push(id)}
        mouseBoundsForItem={(_item, index) => ({
          x: 0,
          y: index,
          width: 12,
          height: 1,
        })}
      />,
    )

    await delay(100)
    stdin.write('\u001B[<0;1;1M')
    await delay()
    stdin.write('\u001B[<0;1;1m')
    await delay()

    expect(selected).toEqual(['b'])
  })

  it('automatically hit-tests only the filtered visible rows', async () => {
    const selected: string[] = []
    const activated: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <SelectableList
          items={sampleItems}
          filterQuery="Banana"
          onSelect={(id) => selected.push(id)}
          onActivate={(id) => activated.push(id)}
        />
      </MouseLayout>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Banana'))
    expect(selected).toEqual(['b'])

    stdin.write('\r')
    await delay()
    expect(activated).toEqual(['b'])
  })

  it('inherits List wheel scrolling without changing selection or activation', async () => {
    const items: ListItem[] = Array.from({ length: 4 }, (_, index) => ({
      id: `selectable-${index}`,
      label: `Selectable ${index}`,
    }))
    const selected: string[] = []
    const activated: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        width={40}
        height={10}
        flexDirection="column"
      >
        <SelectableList
          items={items}
          maxVisible={2}
          onSelect={(id) => selected.push(id)}
          onActivate={(id) => activated.push(id)}
        />
      </MouseLayout>,
    )
    await delay(120)

    const firstCell = cellInFrame(lastFrame(), 'Selectable 0')
    await wheelCell(stdin, firstCell)
    expect(lastFrame()).not.toContain('Selectable 0')
    expect(lastFrame()).toContain('Selectable 1')
    expect(lastFrame()).toContain('Selectable 2')
    expect(selected).toEqual([])
    expect(activated).toEqual([])
  })
})
