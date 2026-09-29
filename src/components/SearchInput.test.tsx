import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { SearchInput } from './SearchInput.js'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const mouseRegistry = new ScreenRegistry()
mouseRegistry.register({ id: 'test', title: 'Test', component: () => null })

function renderInFramework(ui: ReactElement) {
  return render(
    <FrameworkProvider registry={mouseRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>,
  )
}

function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found: ${marker}`)
}

async function clickAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}M`)
  await delay()
  stdin.write(`\u001B[<0;${x + 1};${y + 1}m`)
  await delay()
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

async function typeChars(
  stdin: { write: (d: string) => void },
  text: string,
) {
  for (const ch of text) {
    stdin.write(ch)
    await delay(30)
  }
}

describe('SearchInput', () => {
  it('renders placeholder when empty', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput placeholder="Type here..." />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Type here...')
  })

  it('renders default placeholder when not specified', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Search...')
  })

  it('displays the controlled value as-is', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput value="hello world" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('hello world')
  })

  it('shows cursor indicator at end', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput value="test" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('test')
    expect(frame).toContain('|')
  })

  it('does not show cursor indicator alone when text present', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput value="test" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    // cursor should be after text, not instead of it
    expect(frame).toContain('test|')
  })

  it('accepts typed characters (uncontrolled)', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'hello')
    expect(lastFrame()).toContain('hello')
  })

  it('handles backspace to remove last character', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'abc')
    expect(lastFrame()).toContain('abc')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('ab')
    expect(lastFrame()).not.toContain('abc')
  })

  it('calls onChange in uncontrolled mode', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'cat')
    expect(changes).toEqual(['c', 'ca', 'cat'])
  })

  it('calls onChange on backspace', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'ab')
    changes.length = 0
    stdin.write('\b')
    await delay()
    expect(changes).toEqual(['a'])
  })

  it('works in controlled mode — calls onChange with appended value', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput value="test" onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('x')
    await delay()
    expect(changes).toEqual(['testx'])
  })

  it('does not update display in controlled mode when prop stays same', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput value="fixed" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('fixed')

    stdin.write('x')
    await delay()
    // value prop is "fixed" so display stays "fixed"
    expect(lastFrame()).toContain('fixed')
    expect(lastFrame()).not.toContain('fixedx')
  })

  it('remains empty after backspace when already empty', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <SearchInput placeholder="empty" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('empty')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('empty')
  })

  it('sends keyboard edits to the input selected by an SGR click', async () => {
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <SearchInput placeholder="first search" onChange={firstChange} />
        <SearchInput placeholder="second search" onChange={secondChange} />
      </MouseLayout>,
    )

    await delay()
    const second = findMarker(lastFrame() ?? '', 'second search')
    await clickAt(stdin, second.x, second.y)
    stdin.write('x')
    await delay()

    expect(firstChange).not.toHaveBeenCalled()
    expect(secondChange).toHaveBeenCalledWith('x')
  })
})
