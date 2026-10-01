import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { useEffect, type ReactNode } from 'react'
import type { ReactElement } from 'react'
import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useKeyboardScope } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../../commands/actions/ScopedActionRegistryProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { RadioList } from './RadioList.js'
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
    const { stdin, lastFrame } = renderInFramework(
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
    await moveCell(stdin, { x: 1, y: 2 })
    expect(selected).toEqual([])
    await moveOutside(stdin)

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

  it('auto hover does not move keyboard focus or select', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <ListScope>
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <RadioList
            options={optionsWithDisabled}
            selected={null}
            onSelect={(value) => selected.push(value)}
          />
        </MouseLayout>
      </ListScope>,
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

  it('keeps the selected, focused option underlined on hover without selecting it', async () => {
    await withColorOutput(async () => {
      const selected: string[] = []
      const { stdin, lastFrame } = renderInFramework(
        <ListScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <RadioList
              options={sampleOptions}
              selected="opt2"
              onSelect={(value) => selected.push(value)}
            />
          </MouseLayout>
        </ListScope>,
      )

      await delay(120)
      const selectedRow = cellInFrame(lastFrame(), 'Option 2')
      await moveCell(stdin, selectedRow)
      expect(isUnderlined(lastFrame())).toBe(true)
      expect(selected).toEqual([])

      await clickCell(stdin, selectedRow)
      expect(selected).toEqual(['opt2'])
    })
  })

  it('automatically hit-tests options, consumes disabled rows, and focuses the clicked option', async () => {
    const selected: string[] = []
    const { stdin, lastFrame } = renderInFramework(
      <ListScope>
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <RadioList
            options={optionsWithDisabled}
            selected={null}
            onSelect={(value) => selected.push(value)}
          />
        </MouseLayout>
      </ListScope>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Beta'))
    expect(selected).toEqual([])

    await clickCell(stdin, cellInFrame(lastFrame(), 'Gamma'))
    expect(selected).toEqual(['c'])

    stdin.write('\r')
    await delay()
    expect(selected).toEqual(['c', 'c'])
  })
})

describe('RadioList theme integration', () => {
  it('applies global radio symbols', () => {
    const { lastFrame } = renderWithTheme(
      { symbols: { radioList: { selected: '◉', unselected: '◯' } } },
      <RadioList options={sampleOptions} selected="opt1" onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(stripAnsi(frame)).toContain('◉ Option 1')
    expect(stripAnsi(frame)).toContain('◯ Option 2')
    expect(stripAnsi(frame)).toContain('◯ Option 3')
  })

  it('lets component symbols override global radio symbols', () => {
    const { lastFrame } = renderWithTheme(
      {
        symbols: { radioList: { selected: '◉', unselected: '◯' } },
        components: {
          radioList: { symbols: { selected: '●', unselected: '○' } },
        },
      },
      <RadioList options={sampleOptions} selected="opt1" onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(stripAnsi(frame)).toContain('● Option 1')
    expect(frame).not.toContain('◉')
  })

  it('applies component color overrides to the selected symbol and label', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      {
        components: {
          radioList: { colors: { selected: 'magenta', label: 'green' } },
        },
      },
      <RadioList options={sampleOptions} selected="opt1" onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u001B[35m')
    expect(frame).toContain('\u001B[32m')
  })

  it('keeps the default radio symbols without a theme', () => {
    const { lastFrame } = renderInTheme(
      <RadioList options={sampleOptions} selected="opt1" onSelect={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(stripAnsi(frame)).toContain('• Option 1')
    expect(stripAnsi(frame)).toContain('○ Option 2')
  })
})
