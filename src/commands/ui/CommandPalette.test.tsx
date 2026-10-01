import { afterEach, describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { useEffect, type ReactNode } from 'react'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useKeyboardScope } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import chalk from 'chalk'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ActionRegistry } from '../actions/ActionRegistry.js'
import { CommandPalette } from './CommandPalette.js'
import type { ThemeOverrides } from '../../types.js'

function createTestRegistry() {
  const r = new ActionRegistry()
  r.register({
    id: 'start',
    label: 'Start Daily Plan',
    description: 'Begin your daily session',
    category: 'learning',
    handler: () => {},
  })
  r.register({
    id: 'speak',
    label: 'Speaking Practice',
    description: 'Practice speaking',
    category: 'learning',
    handler: () => {},
  })
  r.register({
    id: 'stats',
    label: 'View Statistics',
    description: 'Show progress stats',
    category: 'system',
    handler: () => {},
    shortcut: 't',
  })
  r.register({
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Go to dashboard',
    category: 'navigation',
    handler: () => {},
    shortcut: 'b',
  })
  return r
}

async function typeChars(
  stdin: { write: (d: string) => unknown },
  text: string,
) {
  for (const ch of text) {
    stdin.write(ch)
    await delay(30)
  }
}

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function renderWithTheme(theme: ThemeOverrides, ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <KeyboardScopeProvider>{ui}</KeyboardScopeProvider>
    </ThemeProvider>,
  )
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

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

async function moveCell(
  stdin: { write: (data: string) => unknown },
  cell: { x: number; y: number },
) {
  const x = cell.x + 1
  const y = cell.y + 1
  stdin.write(`\u001B[<35;${x};${y}M`)
  await delay()
}

function CommandScope({ children }: { children: ReactNode }) {
  const keyboardScope = useKeyboardScope()
  useEffect(() => {
    keyboardScope.pushScope('command')
    return () => keyboardScope.popScope('command')
  }, [keyboardScope.pushScope, keyboardScope.popScope])
  return children
}

const interactionRegistry = new ScreenRegistry()
interactionRegistry.register({ id: 'test', title: 'Test', component: () => null })

describe('CommandPalette', () => {
  let registry: ActionRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('renders command prompt', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('>')
    expect(lastFrame()).toContain('|')
  })

  it('shows all actions on empty query', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Start Daily Plan')
    expect(frame).toContain('Speaking Practice')
    expect(frame).toContain('View Statistics')
    expect(frame).toContain('Dashboard')
  })

  it('shows category headers', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('LEARNING')
    expect(frame).toContain('SYSTEM')
    expect(frame).toContain('NAVIGATION')
  })

  it('filters results as user types', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )

    expect(lastFrame()).toContain('Start Daily Plan')

    await typeChars(stdin, 'spk')
    const frame = lastFrame()
    expect(frame).toContain('Speaking Practice')
    expect(frame).not.toContain('Start Daily Plan')
  })

  it('shows no results state for unmatched query', () => {
    const noMatchRegistry = new ActionRegistry()
    noMatchRegistry.register({
      id: 'test', label: 'Something Unrelated', category: 'other', handler: () => {},
    })
    noMatchRegistry.register({
      id: 'other', label: 'Another Item', category: 'other', handler: () => {},
    })

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={noMatchRegistry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Something Unrelated')
  })

  it('shows hint on initial open', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Start Daily Plan')
  })

  it('calls onClose on Escape', async () => {
    let closed = false
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={registry} onClose={() => { closed = true }} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\u001b')
    await delay()
    expect(closed).toBe(true)
  })

  it('executes selected action on Enter', async () => {
    const executed: string[] = []
    const execRegistry = new ActionRegistry()
    execRegistry.register({
      id: 'test-action',
      label: 'Test Action',
      category: 'test',
      handler: () => executed.push('test-action'),
    })

    let closed = false
    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={execRegistry} onClose={() => { closed = true }} />
      </KeyboardScopeProvider>,
    )
    stdin.write('\r')
    await delay()
    expect(executed).toContain('test-action')
    expect(closed).toBe(true)
  })

  it('selects different item with arrows and executes on Enter', async () => {
    const executed: string[] = []
    const execRegistry = new ActionRegistry()
    execRegistry.register({
      id: 'first',
      label: 'First Action',
      category: 'test',
      handler: () => executed.push('first'),
    })
    execRegistry.register({
      id: 'second',
      label: 'Second Action',
      category: 'test',
      handler: () => executed.push('second'),
    })

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={execRegistry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )

    stdin.write('\u001b[B')
    await delay()
    stdin.write('\r')
    await delay()
    expect(executed).toContain('second')
    expect(executed).not.toContain('first')
  })

  it('handles backspace to edit query', async () => {
    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="command">
        <CommandPalette registry={registry} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )

    await typeChars(stdin, 'spk')
    expect(lastFrame()).toContain('Speaking Practice')

    stdin.write('\b')
    await delay()
    expect(lastFrame()).toContain('Speaking Practice')
    expect(lastFrame()).toContain('Start Daily Plan')
  })

  it('click selects a command result and Enter still activates it', async () => {
    const executed: string[] = []
    const execRegistry = new ActionRegistry()
    execRegistry.register({
      id: 'first',
      label: 'First Action',
      category: 'test',
      handler: () => executed.push('first'),
    })
    execRegistry.register({
      id: 'second',
      label: 'Second Action',
      category: 'test',
      handler: () => executed.push('second'),
    })

    let closed = false
    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <CommandScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <CommandPalette
              registry={execRegistry}
              onClose={() => {
                closed = true
              }}
            />
          </MouseLayout>
        </CommandScope>
      </FrameworkProvider>,
    )

    await delay(120)
    await clickCell(stdin, cellInFrame(lastFrame(), 'Second Action'))
    expect(lastFrame()).toContain('> Second Action')
    expect(executed).toEqual([])

    stdin.write('\r')
    await delay()
    expect(executed).toEqual(['second'])
    expect(closed).toBe(true)
  })

  it('shows a hover cue on the selected row without changing selection or executing', async () => {
    chalk.level = 1
    const executed: string[] = []
    const execRegistry = new ActionRegistry()
    execRegistry.register({
      id: 'first',
      label: 'First Action',
      category: 'test',
      handler: () => executed.push('first'),
    })
    execRegistry.register({
      id: 'second',
      label: 'Second Action',
      category: 'test',
      handler: () => executed.push('second'),
    })

    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
        <CommandScope>
          <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
            <CommandPalette registry={execRegistry} onClose={() => {}} />
          </MouseLayout>
        </CommandScope>
      </FrameworkProvider>,
    )

    await delay(120)
    const initial = lastFrame() ?? ''
    await moveCell(stdin, cellInFrame(initial, 'First Action'))
    const hovered = lastFrame() ?? ''
    expect(hovered).not.toBe(initial)
    expect(hovered.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')).toBe(
      initial.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, ''),
    )
    expect(hovered).toContain('> First Action')
    expect(hovered).not.toContain('> Second Action')
    expect(executed).toEqual([])

    await moveCell(stdin, cellInFrame(initial, 'TEST'))
    expect(lastFrame()).toBe(initial)
  })
})

describe('CommandPalette theme integration', () => {
  it('applies the global command palette border style', () => {
    const { lastFrame } = renderWithTheme(
      { layout: { commandPaletteBorderStyle: 'double' } },
      <CommandPalette registry={createTestRegistry()} onClose={() => {}} />,
    )
    expect(lastFrame()).toContain('╔')
  })

  it('lets the component borderStyle override the global layout style', () => {
    const { lastFrame } = renderWithTheme(
      {
        layout: { commandPaletteBorderStyle: 'double' },
        components: { commandPalette: { borderStyle: 'bold' } },
      },
      <CommandPalette registry={createTestRegistry()} onClose={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('┏')
    expect(frame).not.toContain('╔')
  })

  it('applies component color overrides to the border and selected row', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      {
        components: {
          commandPalette: { colors: { border: 'magenta', selected: 'green' } },
        },
      },
      <CommandPalette registry={createTestRegistry()} onClose={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u001B[35m')
    expect(frame).toContain('\u001B[32m')
  })

  it('keeps the default round border and colors without a theme', () => {
    chalk.level = 1
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <CommandPalette registry={createTestRegistry()} onClose={() => {}} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('╭')
    expect(frame).toContain('\u001B[36m')
  })
})
