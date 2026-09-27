import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { normalizeFrame } from '../../test/integration-helpers.js'
import { App } from '../apps/command-console.js'

describe('command-console integration', () => {
  it('renders the console UI without crashing', () => {
    const { lastFrame } = render(<App />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Command Console')
    expect(frame).toContain('Press Enter to type a command.')
  })
})
