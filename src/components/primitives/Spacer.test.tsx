import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { Spacer } from './Spacer.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Spacer', () => {
  it('renders with default size (md)', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Text>a</Text>
        <Spacer />
        <Text>b</Text>
      </>,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })

  it('renders with sm size', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Text>a</Text>
        <Spacer size="sm" />
        <Text>b</Text>
      </>,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })

  it('renders with md size', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Text>a</Text>
        <Spacer size="md" />
        <Text>b</Text>
      </>,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })

  it('renders with lg size', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Text>a</Text>
        <Spacer size="lg" />
        <Text>b</Text>
      </>,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })
})
