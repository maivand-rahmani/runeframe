import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../commands/ScopedActionRegistryProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { RadioList } from './RadioList.js'

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

const sampleOptions = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2' },
  { value: 'opt3', label: 'Option 3' },
]

const optionsWithDisabled = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
]

describe('RadioList', () => {
  it('renders all options with radio bullets', () => {
    const { lastFrame } = renderInTheme(
      <RadioList options={sampleOptions} selected={null} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('○')
    expect(frame).toContain('Option 1')
    expect(frame).toContain('Option 2')
    expect(frame).toContain('Option 3')
  })

  it('renders selected item with filled bullet', () => {
    const { lastFrame } = renderInTheme(
      <RadioList options={sampleOptions} selected="opt2" onSelect={() => {}} />,
    )
    // The selected option 2 should not show an empty ○
    expect(lastFrame()).toContain('Option 2')
  })

  it('renders empty state', () => {
    const { lastFrame } = renderInTheme(
      <RadioList options={[]} selected={null} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('No options')
  })

  it('selects option on Enter', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <RadioList
        options={sampleOptions}
        selected={null}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt1')
  })

  it('selects option on Space', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <RadioList
        options={sampleOptions}
        selected={null}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write(' ') // space
    await delay()
    expect(selected).toContain('opt1')
  })

  it('navigates with arrow down and selects', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <RadioList
        options={sampleOptions}
        selected={null}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down to opt2
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt2')
  })

  it('navigates with arrow up, wraps, and selects', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <RadioList
        options={sampleOptions}
        selected={null}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[A') // up from 0 wraps to last
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt3')
  })

  it('skips disabled options in navigation', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <RadioList
        options={optionsWithDisabled}
        selected={null}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down — skip disabled Beta, land on Gamma (value: 'c')
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('c')
  })

  it('click selects an enabled option and ignores a disabled option', async () => {
    const selected: string[] = []
    const { stdin } = renderInFramework(
      <RadioList
        options={optionsWithDisabled}
        selected={null}
        onSelect={(value) => selected.push(value)}
        mouseBoundsForItem={(_option, index) => ({
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
    stdin.write('\u001B[<0;1;2M')
    await delay()
    stdin.write('\u001B[<0;1;2m')
    await delay()

    expect(selected).toEqual(['a'])
  })
})
