import { describe, it, expect, beforeEach } from 'vitest'
import { EventTracer } from './EventTracer.js'
import type { NormalizedKeyEvent } from '../../types.js'

function makeEvent(overrides: Partial<NormalizedKeyEvent> = {}): NormalizedKeyEvent {
  return {
    text: '',
    key: 'enter',
    code: 'enter',
    isPrintable: false,
    backspace: false,
    enter: true,
    escape: false,
    tab: false,
    space: false,
    up: false,
    down: false,
    left: false,
    right: false,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    rawInput: '',
    ...overrides,
  }
}

describe('EventTracer', () => {
  let tracer: EventTracer

  beforeEach(() => {
    tracer = new EventTracer()
  })

  it('starts disabled by default', () => {
    expect(tracer.enabled).toBe(false)
  })

  it('does not record trace when disabled', () => {
    const event = makeEvent({ key: 'a' })
    tracer.trace(event, { consumed: true, scope: 'navigation' })
    expect(tracer.getTrace()).toHaveLength(0)
  })

  it('records trace when enabled', () => {
    tracer.enable()
    const event = makeEvent({ key: 'b' })
    tracer.trace(event, { consumed: true, scope: 'navigation' })
    expect(tracer.getTrace()).toHaveLength(1)
  })

  it('stores event and result in trace entry', () => {
    tracer.enable()
    const event = makeEvent({ key: 'escape', escape: true })
    tracer.trace(event, { consumed: true, scope: 'modal' })
    const entries = tracer.getTrace()
    expect(entries[0].event.key).toBe('escape')
    expect(entries[0].consumedBy).toBe('modal')
    expect(entries[0].timestamp).toBeGreaterThan(0)
  })

  it('sets consumedBy to null for unconsumed events', () => {
    tracer.enable()
    tracer.trace(makeEvent({ key: 'x' }), { consumed: false, scope: null })
    expect(tracer.getTrace()[0].consumedBy).toBeNull()
  })

  it('getTrace returns a copy (immutable from outside)', () => {
    tracer.enable()
    tracer.trace(makeEvent({ key: 'a' }), { consumed: true, scope: 'nav' })
    const entries = tracer.getTrace()
    entries.length = 0
    expect(tracer.getTrace()).toHaveLength(1)
  })

  it('clear empties the buffer', () => {
    tracer.enable()
    tracer.trace(makeEvent(), { consumed: true, scope: 'list' })
    tracer.trace(makeEvent({ key: 'b' }), { consumed: true, scope: 'list' })
    expect(tracer.getTrace()).toHaveLength(2)
    tracer.clear()
    expect(tracer.getTrace()).toHaveLength(0)
  })

  it('disable stops recording', () => {
    tracer.enable()
    tracer.trace(makeEvent({ key: 'a' }), { consumed: true, scope: 'nav' })
    tracer.disable()
    tracer.trace(makeEvent({ key: 'b' }), { consumed: true, scope: 'nav' })
    expect(tracer.getTrace()).toHaveLength(1)
  })

  it('enable/disable toggles correctly', () => {
    expect(tracer.enabled).toBe(false)
    tracer.enable()
    expect(tracer.enabled).toBe(true)
    tracer.disable()
    expect(tracer.enabled).toBe(false)
  })

  it('respects maxEntries limit', () => {
    const max = 5
    const small = new EventTracer(max)
    small.enable()
    for (let i = 0; i < 10; i++) {
      small.trace(makeEvent({ key: String(i) }), { consumed: true, scope: 'nav' })
    }
    const entries = small.getTrace()
    expect(entries).toHaveLength(max)
    expect(entries[0].event.key).toBe('5')
    expect(entries[max - 1].event.key).toBe('9')
  })

  it('default maxEntries is 200', () => {
    const defaultTracer = new EventTracer()
    defaultTracer.enable()
    for (let i = 0; i < 250; i++) {
      defaultTracer.trace(makeEvent({ key: 'x' }), { consumed: true, scope: 'nav' })
    }
    expect(defaultTracer.getTrace()).toHaveLength(200)
  })

  it('records handlerChain when provided', () => {
    tracer.enable()
    tracer.trace(makeEvent({ key: 'tab' }), {
      consumed: true,
      scope: 'navigation',
      handlerChain: ['navigation', 'list', 'textinput'],
    })
    const entry = tracer.getTrace()[0]
    expect(entry.handlerChain).toEqual(['navigation', 'list', 'textinput'])
  })
})
