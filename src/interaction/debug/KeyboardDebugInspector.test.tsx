import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import chalk from 'chalk'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../keyboard/KeyboardScopeProvider.js'
import { KeyboardDebugInspector } from './KeyboardDebugInspector.js'
import { EventTracer } from './EventTracer.js'
import type { NormalizedKeyEvent, ThemeOverrides } from '../../types.js'

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

function renderInspector(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function renderInspectorWithTheme(theme: ThemeOverrides, ui: ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function nonPrintingEvent(key: string): NormalizedKeyEvent {
  return {
    text: '',
    key,
    code: key,
    isPrintable: false,
    backspace: key === 'backspace',
    enter: key === 'enter',
    escape: key === 'escape',
    tab: key === 'tab',
    space: key === 'space',
    up: key === 'up',
    down: key === 'down',
    left: key === 'left',
    right: key === 'right',
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    rawInput: '',
  }
}

describe('KeyboardDebugInspector', () => {
  let tracer: EventTracer

  beforeEach(() => {
    tracer = new EventTracer()
    tracer.enable()
  })

  it('renders without crashing', () => {
    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toBeTruthy()
  })

  it('displays scope stack', () => {
    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('navigation')
  })

  it('displays empty trace when no events recorded', () => {
    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('No events')
  })

  it('displays consumed trace events', () => {
    tracer.trace(nonPrintingEvent('enter'), { consumed: true, scope: 'modal' })

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    const output = lastFrame()
    expect(output).toContain('enter')
    expect(output).toContain('consumed')
    expect(output).toContain('modal')
  })

  it('displays unconsumed trace events', () => {
    tracer.trace(nonPrintingEvent('x'), { consumed: false, scope: null })

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('unconsumed')
  })

  it('uses custom getActiveScopeStack when provided', () => {
    const customStack = () => ['modal', 'textinput', 'navigation']

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector
          tracer={tracer}
          getActiveScopeStack={customStack}
        />
      </KeyboardScopeProvider>,
    )
    const output = lastFrame()
    expect(output).toContain('modal')
    expect(output).toContain('textinput')
  })

  it('uses custom getActiveFocusPath when provided', () => {
    const customPath = () => ['zone-1', 'group-2', 'item-3']

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector
          tracer={tracer}
          getActiveFocusPath={customPath}
        />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('item-3')
  })

  it('shows handler chain in trace entries', () => {
    tracer.trace(nonPrintingEvent('tab'), {
      consumed: true,
      scope: 'navigation',
      handlerChain: ['navigation', 'list'],
    })

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('navigation')
  })

  it('limits trace display to last 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      tracer.trace(nonPrintingEvent('x'), { consumed: false, scope: null })
    }

    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )

    const output = lastFrame()
    const xCount = (output?.match(/unconsumed/g) || []).length
    expect(xCount).toBeLessThanOrEqual(10)
  })
})

describe('KeyboardDebugInspector theme integration', () => {
  let tracer: EventTracer

  beforeEach(() => {
    tracer = new EventTracer()
    tracer.enable()
  })

  it('applies the global debug inspector border style', () => {
    const { lastFrame } = renderInspectorWithTheme(
      { layout: { debugInspectorBorderStyle: 'double' } },
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('╔')
  })

  it('lets the component borderStyle override the global layout style', () => {
    const { lastFrame } = renderInspectorWithTheme(
      {
        layout: { debugInspectorBorderStyle: 'double' },
        components: { keyboardDebugInspector: { borderStyle: 'bold' } },
      },
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('┏')
    expect(frame).not.toContain('╔')
  })

  it('applies component color overrides to consumed and unconsumed traces', () => {
    chalk.level = 1
    tracer.trace(nonPrintingEvent('enter'), { consumed: true, scope: 'modal' })
    tracer.trace(nonPrintingEvent('x'), { consumed: false, scope: null })

    const { lastFrame } = renderInspectorWithTheme(
      {
        components: {
          keyboardDebugInspector: {
            colors: { consumed: 'magenta', unconsumed: 'green' },
          },
        },
      },
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u001B[35m')
    expect(frame).toContain('\u001B[32m')
  })

  it('keeps the default single border and trace colors without a theme', () => {
    chalk.level = 1
    tracer.trace(nonPrintingEvent('enter'), { consumed: true, scope: 'modal' })
    const { lastFrame } = renderInspector(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('┌')
    expect(frame).toContain('\u001B[32m')
  })
})
