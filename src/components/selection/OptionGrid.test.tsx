import { describe, it, expect } from 'vitest'
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
import { OptionGrid } from './OptionGrid.js'
import type { ThemeOverrides } from '../../types.js'

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

const interactionRegistry = new ScreenRegistry()
interactionRegistry.register({ id: 'test', title: 'Test', component: () => null })

const sampleOptions = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2' },
  { value: 'opt3', label: 'Option 3' },
  { value: 'opt4', label: 'Option 4' },
]

const optionsWithDisabled = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
  { value: 'd', label: 'Delta' },
]

describe('OptionGrid', () => {
  it('renders all options', () => {
    const { lastFrame } = renderInTheme(
      <OptionGrid options={sampleOptions} onSelect={() => {}} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Option 1')
    expect(frame).toContain('Option 2')
    expect(frame).toContain('Option 3')
    expect(frame).toContain('Option 4')
  })

  it('renders empty state', () => {
    const { lastFrame } = renderInTheme(
      <OptionGrid options={[]} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('No options')
  })

  it('selects option on Enter', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <OptionGrid
        options={sampleOptions}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt1')
  })

  it('navigates right', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <OptionGrid
        options={sampleOptions}
        columns={2}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[C') // right
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt2')
  })

  it('navigates left', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <OptionGrid
        options={sampleOptions}
        columns={2}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[C') // right to opt2
    await delay()
    stdin.write('\u001b[D') // left back to opt1
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt1')
  })

  it('navigates down to next row', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <OptionGrid
        options={sampleOptions}
        columns={2}
        onSelect={(value) => selected.push(value)}
      />,
    )
    await delay()
    stdin.write('\u001b[B') // down to opt3 (row 2, col 0)
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toContain('opt3')
  })

  it('skips disabled options in navigation', async () => {
    const selected: string[] = []
    const { stdin } = renderInTheme(
      <OptionGrid
        options={optionsWithDisabled}
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

  it('automatically hit-tests each cell, consumes disabled cells, and focuses clicks', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <ListScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <OptionGrid
              options={optionsWithDisabled}
              columns={2}
              onSelect={(value) => selected.push(value)}
            />
          </MouseLayout>
        </ListScope>
      </FrameworkProvider>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Beta'))
    expect(selected).toEqual([])

    await clickCell(stdin, cellInFrame(lastFrame(), 'Delta'))
    expect(selected).toEqual(['d'])

    stdin.write('\u001B[D')
    await delay()
    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['d', 'c'])
  })

  it('auto hover does not move keyboard focus or select', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <ListScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <OptionGrid
              options={optionsWithDisabled}
              columns={2}
              onSelect={(value) => selected.push(value)}
            />
          </MouseLayout>
        </ListScope>
      </FrameworkProvider>,
    )

    await delay(120)
    await moveCell(stdin, cellInFrame(lastFrame(), 'Alpha'))
    await moveCell(stdin, cellInFrame(lastFrame(), 'Beta'))
    await moveCell(stdin, cellInFrame(lastFrame(), 'Gamma'))
    expect(selected).toEqual([])

    await moveOutside(stdin)
    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['a'])
  })

  it('keeps the focused cell underlined on hover without selecting it', async () => {
    await withColorOutput(async () => {
      const selected: string[] = []
      const { stdin, lastFrame } = render(
        <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
          <ListScope>
            <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
              <OptionGrid
                options={sampleOptions}
                onSelect={(value) => selected.push(value)}
              />
            </MouseLayout>
          </ListScope>
        </FrameworkProvider>,
      )

      await delay(120)
      await moveCell(stdin, cellInFrame(lastFrame(), 'Option 1'))
      expect(isUnderlined(lastFrame())).toBe(true)
      expect(selected).toEqual([])

      stdin.write('\r')
      await delay()
      expect(selected).toEqual(['opt1'])
    })
  })
})

function plainFrame(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

describe('OptionGrid theme integration', () => {
  it('applies the component columnGap layout override', () => {
    const { lastFrame } = renderWithTheme(
      { components: { optionGrid: { layout: { columnGap: 4 } } } },
      <OptionGrid options={sampleOptions.slice(0, 2)} onSelect={() => {}} />,
    )
    expect(plainFrame(lastFrame())).toContain('Option 1    Option 2')
  })

  it('applies the component label color override', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      {
        components: { optionGrid: { colors: { label: 'magenta' } } },
      },
      <OptionGrid options={sampleOptions.slice(0, 2)} onSelect={() => {}} />,
    )
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('keeps the default column gap and colors without a theme', () => {
    chalk.level = 1
    const { lastFrame } = renderInTheme(
      <OptionGrid options={sampleOptions.slice(0, 2)} onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(plainFrame(frame)).toContain('Option 1  Option 2')
    expect(frame).toContain('\u001B[36m')
  })
})
