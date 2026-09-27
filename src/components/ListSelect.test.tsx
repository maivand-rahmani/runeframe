import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../commands/ScopedActionRegistryProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { ListSelect, type ListSelectItem } from './ListSelect.js'

function renderInTheme(ui: ReactElement) {
  return render(
    <ThemeProvider>
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
})
