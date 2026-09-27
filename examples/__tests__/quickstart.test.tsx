import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { normalizeFrame } from '../../test/integration-helpers.js'
import { App } from '../apps/quickstart.js'

describe('quickstart smoke', () => {
  it('renders through full FrameworkProvider stack without errors', () => {
    const { lastFrame } = render(<App />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Runeframe')
    expect(frame).toContain('Home')
  })

  it('emits deterministic frame output', () => {
    const { lastFrame } = render(<App />)
    const frame1 = normalizeFrame(lastFrame())
    const { lastFrame: lastFrame2 } = render(<App />)
    const frame2 = normalizeFrame(lastFrame2())
    expect(frame1).toBe(frame2)
  })
})
