import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { Section } from './Section.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Section', () => {
  it('renders with label', () => {
    const { lastFrame } = renderInTheme(
      <Section label="Details">
        <Text>content</Text>
      </Section>,
    )
    expect(lastFrame()).toContain('Details')
    expect(lastFrame()).toContain('content')
  })

  it('renders without label', () => {
    const { lastFrame } = renderInTheme(
      <Section>
        <Text>no label</Text>
      </Section>,
    )
    expect(lastFrame()).toContain('no label')
  })

  it('renders children content', () => {
    const { lastFrame } = renderInTheme(
      <Section>
        <Text>child one</Text>
        <Text>child two</Text>
      </Section>,
    )
    expect(lastFrame()).toContain('child one')
    expect(lastFrame()).toContain('child two')
  })

  it('renders label in bold', () => {
    const { lastFrame } = renderInTheme(
      <Section label="Heading">
        <Text>body</Text>
      </Section>,
    )
    expect(lastFrame()).toContain('Heading')
    expect(lastFrame()).toContain('body')
  })
})
