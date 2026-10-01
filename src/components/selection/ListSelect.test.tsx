import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { useEffect, type ReactNode } from 'react'
import type { ReactElement } from 'react'
import chalk from 'chalk'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useKeyboardScope } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../../commands/actions/ScopedActionRegistryProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ListSelect, type ListSelectItem } from './ListSelect.js'
import type { ThemeOverrides } from '../../types.js'

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

function renderInTheme(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <KeyboardScopeProvider defaultScope="list">
        <ScopedActionRegistryProvider>{ui}</ScopedActionRegistryProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>,
  )
}

function renderWithTheme(theme: ThemeOverrides, ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <KeyboardScopeProvider defaultScope="list">
        <ScopedActionRegistryProvider>{ui}</ScopedActionRegistryProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>,
  )
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

function isUnderlined(frame: string | undefined) {
  return /\u001B\[(?:\d+;)*4(?:;\d+)*m/.test(frame ?? '')
}

async function withColorOutput(run: () => Promise<void>) {
  const previousLevel = chalk.level
  chalk.level = 1
  try {
    await run()
  } finally {
    chalk.level = previousLevel
  }
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

async function moveCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  stdin.write(`\u001B[<35;${cell.x + 1};${cell.y + 1}M`)
  await delay()
}

async function moveOutside(stdin: { write: (data: string) => unknown }) {
  stdin.write('\u001B[<35;50;50M')
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

type StrItem = ListSelectItem<string>

const sampleItems: StrItem[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

const itemsWithDisabled: StrItem[] = [
  { value: 'a', label: 'Enabled A' },
  { value: 'b', label: 'Disabled B', disabled: true },
  { value: 'c', label: 'Enabled C' },
]

describe('ListSelect', () => {
  it('renders all items', () => {
    const { lastFrame } = renderInTheme(
      <ListSelect items={sampleItems} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Alpha')
    expect(frame).toContain('Beta')
    expect(frame).toContain('Gamma')
  })

  it('renders empty state', () => {
    const { lastFrame } = renderInTheme(
      <ListSelect items={[]} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('No items')
  })

  it('selects current item on Enter', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ListSelect
        items={sampleItems}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('a')
  })

  it('moves selection with arrow down', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ListSelect
        items={sampleItems}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B')
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('b')
  })

  it('moves selection with arrow up', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ListSelect
        items={sampleItems}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down to b
    await delay()
    stdin.write('\u001b[A') // up back to a
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('a')
  })

  it('wraps navigation at edges', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ListSelect
        items={sampleItems}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[A') // up from index 0 wraps to last
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('c')
  })

  it('skips disabled items in navigation', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <ListSelect
        items={itemsWithDisabled}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down — skip disabled B
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('c')
  })

  it('respects initialFocus', () => {
    const { lastFrame } = renderInTheme(
      <ListSelect
        items={sampleItems}
        onSelect={() => {}}
        initialFocus={2}
      />,
    )
    // last frame renders — should not crash
    expect(lastFrame()).toContain('Gamma')
  })

  it('click updates focus and selects only enabled rows', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <ListSelect
        items={itemsWithDisabled}
        onSelect={(value) => selected.push(value)}
        mouseBoundsForItem={(_item, index) => ({
          x: 0,
          y: index,
          width: 12,
          height: 1,
        })}
      />,
    )

    await delay(100)
    await moveCell(stdin, { x: 1, y: 2 })
    expect(selected).toEqual([])
    await moveOutside(stdin)

    stdin.write('\u001B[<0;1;3M')
    await delay()
    stdin.write('\u001B[<0;1;3m')
    await delay()
    expect(lastFrame()).toContain('Enabled C')
    expect(selected).toEqual(['c'])

    stdin.write('\u001B[<0;1;2M')
    await delay()
    stdin.write('\u001B[<0;1;2m')
    await delay()
    expect(selected).toEqual(['c'])
  })

  it('auto hover does not move keyboard focus or select', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <ListScope>
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <ListSelect
            items={itemsWithDisabled}
            onSelect={(value) => selected.push(value)}
          />
        </MouseLayout>
      </ListScope>,
    )

    await delay(120)
    await moveCell(stdin, cellInFrame(lastFrame(), 'Enabled A'))
    await moveCell(stdin, cellInFrame(lastFrame(), 'Disabled B'))
    await moveCell(stdin, cellInFrame(lastFrame(), 'Enabled C'))
    expect(selected).toEqual([])

    await moveOutside(stdin)
    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['a'])
  })

  it('keeps the focused row underlined on hover without selecting until clicked', async () => {
    await withColorOutput(async () => {
      const selected: string[] = []
      const { stdin, lastFrame } = renderInFramework(
        <ListScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <ListSelect
              items={sampleItems}
              initialFocus={1}
              onSelect={(value) => selected.push(value)}
            />
          </MouseLayout>
        </ListScope>,
      )

      await delay(120)
      const focusedRow = cellInFrame(lastFrame(), 'Beta')
      await moveCell(stdin, focusedRow)
      expect(isUnderlined(lastFrame())).toBe(true)
      expect(selected).toEqual([])

      await clickCell(stdin, focusedRow)
      expect(selected).toEqual(['b'])
    })
  })

  it('cancels a pressed row when its item is replaced before release', async () => {
    const selected: string[] = []
    const original: StrItem[] = [{ value: 'old', label: 'Old item' }]
    const replacement: StrItem[] = [{ value: 'new', label: 'New item' }]
    const view = (items: StrItem[]) => (
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <ListSelect
          items={items}
          onSelect={(value) => selected.push(value)}
          mouseBoundsForItem={() => ({ x: 0, y: 0, width: 8, height: 1 })}
        />
      </FrameworkProvider>
    )
    const { stdin, rerender } = render(view(original))

    await delay(100)
    stdin.write('\u001B[<0;1;1M')
    await delay()
    rerender(view(replacement))
    await delay()
    stdin.write('\u001B[<0;1;1m')
    await delay()

    expect(selected).toHaveLength(0)
  })

  it('automatically hit-tests options, focuses clicks, and consumes disabled rows', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <ListScope>
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <ListSelect
            items={itemsWithDisabled}
            onSelect={(value) => selected.push(value)}
          />
        </MouseLayout>
      </ListScope>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Disabled B'))
    expect(selected).toEqual([])

    await clickCell(stdin, cellInFrame(lastFrame(), 'Enabled C'))
    expect(selected).toEqual(['c'])

    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['c', 'c'])
  })

  it('cancels an automatic press when reordering replaces the pressed row', async () => {
    const selected: string[] = []
    const reordered = [sampleItems[1], sampleItems[0], sampleItems[2]]
    const view = (items: StrItem[]) => (
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <ListSelect
            items={items}
            onSelect={(value) => selected.push(value)}
          />
        </MouseLayout>
      </FrameworkProvider>
    )
    const { stdin, lastFrame, rerender } = render(view(sampleItems))

    await delay(120)
    const originalCell = cellInFrame(lastFrame(), 'Alpha')
    stdin.write(`\u001B[<0;${originalCell.x + 1};${originalCell.y + 1}M`)
    await delay()
    rerender(view(reordered))
    await delay(100)
    stdin.write(`\u001B[<0;${originalCell.x + 1};${originalCell.y + 1}m`)
    await delay()

    expect(selected).toEqual([])
  })
})

describe('ListSelect theme integration', () => {
  const items: ListSelectItem<string>[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ]

  it('applies the component label color override', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      { components: { listSelect: { colors: { label: 'magenta' } } } },
      <ListSelect items={items} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('keeps the default colors without a theme', () => {
    chalk.level = 1
    const { lastFrame } = renderInTheme(
      <ListSelect items={items} onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u001B[36m')
    expect(frame).toContain('Alpha')
  })
})
