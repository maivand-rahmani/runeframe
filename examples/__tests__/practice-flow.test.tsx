import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { normalizeFrame, delay, typeSequence } from '../../test/integration-helpers.js'
import { ScopedActionRegistryProvider } from '../../src/index.js'
import { App } from '../apps/practice-flow.js'

function renderApp() {
  return render(
    <ScopedActionRegistryProvider>
      <App />
    </ScopedActionRegistryProvider>,
  )
}

describe('practice-flow integration', () => {
  it('renders the first step with track choices', () => {
    const { lastFrame } = renderApp()
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Choose a Track')
  })

  it('navigates through multiple steps via keyboard and captures data', async () => {
    const { lastFrame, stdin } = renderApp()

    // Step 1: Choose 'Guided' track (press 'g' letter shortcut)
    await delay(100)
    stdin.write('g')
    await delay(150)

    let frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Choose Difficulty')

    // Step 2: Choose 'Normal' mode (press 'n')
    stdin.write('n')
    await delay(150)

    frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Number of Questions')

    // Step 3: Submit number input (Enter with default 10)
    stdin.write('\r')
    await delay(150)

    frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Your Name')

    // Step 4: Type a name character by character and submit
    await typeSequence(stdin, [...'TestUser'], 30)
    stdin.write('\r')
    await delay(150)

    // Step 5: Review step shows all choices
    frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Review your choices')
    expect(frame).toContain('TestUser')
  })
})
