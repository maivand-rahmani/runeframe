import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { NumberInput } from './NumberInput.js'
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

describe('NumberInput', () => {
  it('renders initial value of 0 when no defaultValue', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('[')
    expect(frame).toContain('0')
    expect(frame).toContain(']')
  })

  it('renders defaultValue when provided', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={42} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('42')
  })

  it('renders controlled value when provided', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput value={100} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('100')
  })

  it('renders label when provided', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput label="Count" defaultValue={5} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Count')
    expect(lastFrame()).toContain('5')
  })

  it('appends digits to buffer on typing (uncontrolled)', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '42')
    expect(lastFrame()).toContain('42')
  })

  it('handles backspace removing last digit from buffer', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '123')
    expect(lastFrame()).toContain('123')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('12')
    expect(lastFrame()).not.toContain('123')
  })

  it('calls onChange with numeric value while typing', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '42')
    expect(changes).toEqual([4, 42])
  })

  it('calls onChange on backspace', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '42')
    changes.length = 0
    stdin.write('\b')
    await delay()
    expect(changes).toEqual([4])
  })

  it('allows negative number entry via minus prefix', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput />
      </KeyboardScopeProvider>,
    )
    stdin.write('-')
    await delay()
    stdin.write('5')
    await delay()
    expect(lastFrame()).toContain('-5')
  })

  it('submits clamped value on Enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput min={0} max={100} onSubmit={onSubmit} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '150')
    stdin.write('\r')
    await delay()
    expect(onSubmit).toHaveBeenCalledWith(100)
  })

  it('calls onChange and onSubmit with clamped value on Enter', async () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput min={0} max={10} value={5} onChange={onChange} onSubmit={onSubmit} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(onSubmit).toHaveBeenCalledWith(5)
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('increments on up arrow', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={10} onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\u001b[A')
    await delay()
    expect(changes).toEqual([11])
  })

  it('decrements on down arrow', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={10} onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\u001b[B')
    await delay()
    expect(changes).toEqual([9])
  })

  it('clamps increment to max', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={8} max={10} step={5} onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\u001b[A')
    await delay()
    expect(changes).toEqual([10])
  })

  it('clamps decrement to min', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={2} min={0} step={5} onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\u001b[B')
    await delay()
    expect(changes).toEqual([0])
  })

  it('reverts to defaultValue on Escape', async () => {
    const changes: number[] = []
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="textinput">
        <NumberInput defaultValue={42} onChange={(v) => changes.push(v)} />
      </KeyboardScopeProvider>,
    )
    await typeChars(stdin, '99')
    changes.length = 0
    stdin.write('\x1b')
    await delay()
    expect(changes).toEqual([42])
  })

  it('routes arrow input only to the field clicked with SGR mouse input', async () => {
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <NumberInput label="First" defaultValue={2} onChange={firstChange} />
        <NumberInput label="Second" defaultValue={10} onChange={secondChange} />
      </MouseLayout>,
    )

    await delay()
    const second = findMarker(lastFrame() ?? '', 'Second:')
    await clickAt(stdin, second.x, second.y)
    stdin.write('\u001B[A')
    await delay()

    expect(firstChange).not.toHaveBeenCalled()
    expect(secondChange).toHaveBeenCalledWith(11)
  })
})
