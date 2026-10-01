import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { Panel } from './Panel.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Panel', () => {
  it('renders children', () => {
    const { lastFrame } = renderInTheme(
      <Panel>
        <Text>panel content</Text>
      </Panel>,
    )
    expect(lastFrame()).toContain('panel content')
  })

  it('renders with title', () => {
    const { lastFrame } = renderInTheme(
      <Panel title="Settings">
        <Text>content</Text>
      </Panel>,
    )
    expect(lastFrame()).toContain('Settings')
    expect(lastFrame()).toContain('content')
  })

  it('renders without title', () => {
    const { lastFrame } = renderInTheme(
      <Panel>
        <Text>no title</Text>
      </Panel>,
    )
    expect(lastFrame()).toContain('no title')
  })

  it('applies border style from theme', () => {
    const { lastFrame } = renderInTheme(
      <Panel title="Bordered">
        <Text>inside</Text>
      </Panel>,
    )
    expect(lastFrame()).toContain('Bordered')
    expect(lastFrame()).toContain('inside')
  })
})
