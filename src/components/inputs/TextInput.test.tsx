import { afterEach, describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { TextInput } from './TextInput.js'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import chalk from 'chalk'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ModalDialog } from '../overlays/ModalDialog.js'
import type { ThemeOverrides } from '../../types.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function renderWithTheme(theme: ThemeOverrides, ui: ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
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

async function moveAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<35;${x + 1};${y + 1}M`)
  await delay()
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

async function typeChars(
  stdin: { write: (d: string) => void },
  text: string,
) {
  for (const ch of text) {
    stdin.write(ch)
    await delay(30)
  }
}

describe('TextInput', () => {
  it('renders placeholder when value empty', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput placeholder="Enter text..." />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Enter text...')
  })

  it('renders empty placeholder string when not specified', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('|')
  })

  it('displays controlled value as-is', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="hello" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('hello')
  })

  it('shows cursor indicator at end of value', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="test" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('test|')
  })

  it('accepts typed characters (uncontrolled)', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'hello')
    expect(lastFrame()).toContain('hello')
  })

  it('handles backspace to remove last character', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'abc')
    expect(lastFrame()).toContain('abc')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('ab')
    expect(lastFrame()).not.toContain('abc')
  })

  it('calls onChange with each change (uncontrolled)', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'cat')
    expect(changes).toEqual(['c', 'ca', 'cat'])
  })

  it('calls onChange on backspace with new value', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput onChange={(v) => changes.push(v)} />
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
        <TextInput value="test" onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('x')
    await delay()
    expect(changes).toEqual(['testx'])
  })

  it('does not update display in controlled mode when prop stays same', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="fixed" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('fixed')

    stdin.write('x')
    await delay()
    expect(lastFrame()).toContain('fixed')
    expect(lastFrame()).not.toContain('fixedx')
  })

  it('remains empty after backspace when already empty', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput placeholder="empty" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('empty')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('empty')
  })

  it('calls onSubmit on Enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="submit me" onSubmit={onSubmit} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(onSubmit).toHaveBeenCalledWith('submit me')
  })

  it('calls onCancel on Escape', async () => {
    const onCancel = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="cancel me" onCancel={onCancel} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\x1b')
    await delay()
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows validation error when validate returns string', async () => {
    const validate = (v: string) => v.length < 3 ? 'Too short' : null
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="ab" validate={validate} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('Too short')
  })

  it('does not call onSubmit when validation fails', async () => {
    const onSubmit = vi.fn()
    const validate = () => 'Invalid'
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="x" validate={validate} onSubmit={onSubmit} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears validation error on typing', async () => {
    const validate = (v: string) => v.length < 3 ? 'Too short' : null
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput validate={validate} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    stdin.write('ab')
    await delay()
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('Too short')

    stdin.write('c')
    await delay()
    expect(lastFrame()).not.toContain('Too short')
  })

  it('respects maxLength and does not exceed it', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput maxLength={3} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'abcd')
    expect(lastFrame()).toContain('abc')
    expect(lastFrame()).not.toContain('abcd')
  })

  it('moves keyboard focus to the clicked field and transfers input between fields', async () => {
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const secondSubmit = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <TextInput placeholder="first field" onChange={firstChange} />
        <TextInput
          placeholder="second field"
          onChange={secondChange}
          onSubmit={secondSubmit}
        />
      </MouseLayout>,
    )

    await delay()
    const second = findMarker(lastFrame() ?? '', 'second field')
    await clickAt(stdin, second.x, second.y)
    stdin.write('x')
    await delay()
    stdin.write('\r')
    await delay()

    expect(firstChange).not.toHaveBeenCalled()
    expect(secondChange).toHaveBeenCalledWith('x')
    expect(secondSubmit).toHaveBeenCalledWith('x')
  })

  it('shows a hover cue without moving keyboard focus', async () => {
    chalk.level = 1
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <TextInput placeholder="first field" onChange={firstChange} />
        <TextInput placeholder="second field" onChange={secondChange} />
      </MouseLayout>,
    )

    await delay()
    const initial = lastFrame() ?? ''
    const second = findMarker(initial, 'second field')
    await moveAt(stdin, second.x, second.y)
    const hovered = lastFrame() ?? ''
    expect(hovered).not.toBe(initial)
    expect(stripAnsi(hovered)).toBe(stripAnsi(initial))

    await moveAt(stdin, 50, 50)
    expect(lastFrame()).toBe(initial)

    stdin.write('x')
    await delay()
    expect(firstChange).toHaveBeenCalledWith('x')
    expect(secondChange).not.toHaveBeenCalled()

    await clickAt(stdin, second.x, second.y)
    stdin.write('y')
    await delay()
    expect(secondChange).toHaveBeenCalledWith('y')
  })

  it('hit-tests through ModalDialog measured ancestors', async () => {
    const onChange = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <ModalDialog title="Edit" onClose={() => {}}>
          <TextInput placeholder="nested field" onChange={onChange} />
        </ModalDialog>
      </MouseLayout>,
    )

    await delay()
    const field = findMarker(lastFrame() ?? '', 'nested field')
    await clickAt(stdin, field.x, field.y)
    stdin.write('x')
    await delay()

    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('keeps the hover cue on the focused field without hiding its error', async () => {
    chalk.level = 1
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <TextInput
          placeholder="focused text"
          onChange={onChange}
          onSubmit={onSubmit}
          validate={() => 'Invalid value'}
        />
      </MouseLayout>,
    )

    await delay()
    stdin.write('\r')
    await delay()
    const invalid = lastFrame() ?? ''
    expect(invalid).toContain('Invalid value')

    const field = findMarker(invalid, 'focused text')
    await moveAt(stdin, field.x, field.y)
    const hovered = lastFrame() ?? ''
    expect(hovered).not.toBe(invalid)
    expect(stripAnsi(hovered)).toBe(stripAnsi(invalid))
    expect(hovered).toContain('Invalid value')
    expect(onSubmit).not.toHaveBeenCalled()

    stdin.write('x')
    await delay()
    expect(onChange).toHaveBeenCalledWith('x')
  })
})

describe('TextInput theme integration', () => {
  it('applies the global input separator as the cursor', () => {
    const { lastFrame } = renderWithTheme(
      { symbols: { input: { separator: '▏' } } },
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="test" />
      </KeyboardScopeProvider>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('test▏')
  })

  it('lets the component separator override the global input separator', () => {
    const { lastFrame } = renderWithTheme(
      {
        symbols: { input: { separator: '▏' } },
        components: { textInput: { symbols: { separator: '│' } } },
      },
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="test" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(stripAnsi(frame)).toContain('test│')
    expect(frame).not.toContain('▏')
  })

  it('applies component color overrides to the cursor', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      {
        components: { textInput: { colors: { cursor: 'magenta' } } },
      },
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="test" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('keeps the default cursor symbol and colors without a theme', () => {
    chalk.level = 1
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <TextInput value="test" />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(stripAnsi(frame)).toContain('test|')
    expect(frame).toContain('\u001B[36m')
  })
})
