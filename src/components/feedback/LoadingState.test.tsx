import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { LoadingState } from './LoadingState.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('LoadingState', () => {
  it('renders label with detail text', () => {
    const { lastFrame } = renderInTheme(
      <LoadingState label="lesson data" detail="reading local cache" />,
    )

    expect(lastFrame()).toContain(
      'Loading lesson data... (reading local cache)',
    )
  })

  it('renders label without detail text', () => {
    const { lastFrame } = renderInTheme(<LoadingState label="dashboard" />)

    expect(lastFrame()).toContain('Loading dashboard...')
  })

  it('renders deterministic output on every render', () => {
    const first = renderInTheme(
      <LoadingState label="progress summary" detail="warming cache" />,
    ).lastFrame()

    const second = renderInTheme(
      <LoadingState label="progress summary" detail="warming cache" />,
    ).lastFrame()

    expect(first).toBe(second)
  })
})
