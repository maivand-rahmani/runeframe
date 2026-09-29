import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { Divider } from './Divider.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Divider', () => {
  it('renders separator line without label', () => {
    const { lastFrame } = renderInTheme(<Divider />)
    const frame = lastFrame() ?? ''
    expect(frame.length).toBeGreaterThan(0)
  })

  it('renders with label', () => {
    const { lastFrame } = renderInTheme(<Divider label="section" />)
    expect(lastFrame()).toContain('section')
  })

  it('renders without label', () => {
    const { lastFrame } = renderInTheme(<Divider />)
    expect(lastFrame()).toBeDefined()
  })
})
