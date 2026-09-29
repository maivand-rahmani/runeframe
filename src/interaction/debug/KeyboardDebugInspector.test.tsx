import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { KeyboardScopeProvider } from '../keyboard/KeyboardScopeProvider.js'
import { KeyboardDebugInspector } from './KeyboardDebugInspector.js'
import { EventTracer } from './EventTracer.js'
import type { NormalizedKeyEvent } from '../../types.js'

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
    const { lastFrame } = render(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toBeTruthy()
  })

  it('displays scope stack', () => {
    const { lastFrame } = render(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('navigation')
  })

  it('displays empty trace when no events recorded', () => {
    const { lastFrame } = render(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('No events')
  })

  it('displays consumed trace events', () => {
    tracer.trace(nonPrintingEvent('enter'), { consumed: true, scope: 'modal' })

    const { lastFrame } = render(
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

    const { lastFrame } = render(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('unconsumed')
  })

  it('uses custom getActiveScopeStack when provided', () => {
    const customStack = () => ['modal', 'textinput', 'navigation']

    const { lastFrame } = render(
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

    const { lastFrame } = render(
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

    const { lastFrame } = render(
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

    const { lastFrame } = render(
      <KeyboardScopeProvider>
        <KeyboardDebugInspector tracer={tracer} />
      </KeyboardScopeProvider>,
    )

    const output = lastFrame()
    const xCount = (output?.match(/unconsumed/g) || []).length
    expect(xCount).toBeLessThanOrEqual(10)
  })
})
