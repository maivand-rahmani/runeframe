import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { Card } from './Card.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Card', () => {
  it('renders children', () => {
    const { lastFrame } = renderInTheme(
      <Card>
        <Text>card content</Text>
      </Card>,
    )
    expect(lastFrame()).toContain('card content')
  })

  it('renders with default variant', () => {
    const { lastFrame } = renderInTheme(
      <Card variant="default">
        <Text>default</Text>
      </Card>,
    )
    expect(lastFrame()).toContain('default')
  })

  it('renders with elevated variant', () => {
    const { lastFrame } = renderInTheme(
      <Card variant="elevated">
        <Text>elevated</Text>
      </Card>,
    )
    expect(lastFrame()).toContain('elevated')
  })

  it('renders nested components', () => {
    const { lastFrame } = renderInTheme(
      <Card>
        <Text>outer </Text>
        <Text>inner</Text>
      </Card>,
    )
    expect(lastFrame()).toContain('outer')
    expect(lastFrame()).toContain('inner')
  })
})
