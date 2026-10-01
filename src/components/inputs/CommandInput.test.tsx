import { useState, type ReactElement } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { CommandInput, type CommandInputProps } from './CommandInput.js'
import stripAnsi from 'strip-ansi'
import chalk from 'chalk'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'

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

async function moveAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<35;${x + 1};${y + 1}M`)
  await delay()
}

function StatefulCommandInput({
  onChange,
  ...props
}: Omit<CommandInputProps, 'value'> & { onChange?: (v: string) => void }) {
  const [val, setVal] = useState('')
  return (
    <CommandInput
      value={val}
      onChange={(v) => {
        setVal(v)
        onChange?.(v)
      }}
      {...props}
    />
  )
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

describe('CommandInput', () => {
  it('renders prompt character by default', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="" onChange={() => {}} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('>')
  })

  it('renders placeholder when value is empty', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="" onChange={() => {}} onSubmit={() => {}} placeholder="Type command..." />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Type command...')
  })

  it('renders value text when present', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="ls -la" onChange={() => {}} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('ls -la')
  })

  it('shows cursor at end of value', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="test" onChange={() => {}} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('test|')
  })

  it('calls onChange when typing characters', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <StatefulCommandInput mode="command" onChange={(v) => changes.push(v)} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, 'hello')
    expect(changes).toEqual(['h', 'he', 'hel', 'hell', 'hello'])
  })

  it('calls onChange with sliced value on backspace', async () => {
    const changes: string[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="abc" onChange={(v) => changes.push(v)} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\b')
    await delay()
    expect(changes).toEqual(['ab'])
  })

  it('calls onSubmit on Enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="run" onChange={() => {}} onSubmit={onSubmit} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(onSubmit).toHaveBeenCalled()
  })

  it('calls onCancel on Escape in command mode', async () => {
    const onCancel = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="cmd" onChange={() => {}} onSubmit={() => {}} onCancel={onCancel} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\x1b')
    await delay()
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onSubmit on Escape in process mode (kill)', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="process" value="" onChange={() => {}} onSubmit={onSubmit} onCancel={onCancel} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\x1b')
    await delay()
    expect(onSubmit).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('renders custom prompt when provided', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="command" value="" onChange={() => {}} onSubmit={() => {}} prompt="$" />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('$')
    expect(lastFrame()).not.toContain('>')
  })

  it('does not process input in navigation mode', async () => {
    const onChange = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandInput mode="navigation" value="" onChange={onChange} onSubmit={() => {}} />
      </KeyboardScopeProvider>,
    )
    stdin.write('x')
    await delay()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('focuses the clicked command field and routes typing and Enter only there', async () => {
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const firstSubmit = vi.fn()
    const secondSubmit = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <StatefulCommandInput
          mode="command"
          placeholder="first command"
          onChange={firstChange}
          onSubmit={firstSubmit}
        />
        <StatefulCommandInput
          mode="command"
          placeholder="second command"
          onChange={secondChange}
          onSubmit={secondSubmit}
        />
      </MouseLayout>,
    )

    await delay()
    const second = findMarker(lastFrame() ?? '', 'second command')
    await clickAt(stdin, second.x, second.y)
    stdin.write('x')
    await delay()
    stdin.write('\r')
    await delay()

    expect(firstChange).not.toHaveBeenCalled()
    expect(firstSubmit).not.toHaveBeenCalled()
    expect(secondChange).toHaveBeenCalledWith('x')
    expect(secondSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows a hover cue without moving keyboard focus', async () => {
    chalk.level = 1
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <StatefulCommandInput
          mode="command"
          placeholder="first command"
          onChange={firstChange}
          onSubmit={() => {}}
        />
        <StatefulCommandInput
          mode="command"
          placeholder="second command"
          onChange={secondChange}
          onSubmit={() => {}}
        />
      </MouseLayout>,
    )

    await delay()
    const initial = lastFrame() ?? ''
    const second = findMarker(initial, 'second command')
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

  it('shows the hover cue on the auto-focused command field without activating it', async () => {
    chalk.level = 1
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <CommandInput
          mode="command"
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="focused command"
        />
      </MouseLayout>,
    )

    await delay()
    const initial = lastFrame() ?? ''
    const field = findMarker(initial, 'focused command')
    await moveAt(stdin, field.x, field.y)
    const hovered = lastFrame() ?? ''
    expect(hovered).not.toBe(initial)
    expect(stripAnsi(hovered)).toBe(stripAnsi(initial))
    expect(onSubmit).not.toHaveBeenCalled()

    stdin.write('x')
    await delay()
    expect(onChange).toHaveBeenCalledWith('x')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
