import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { EmptyState } from './EmptyState.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('EmptyState', () => {
  it('renders title, description, hint, and action', () => {
    const { lastFrame } = renderInTheme(
      <EmptyState
        title="No lessons yet"
        description="Import a content pack to get started."
        hint="Try eng content import ./packs/b1-core"
        action={<Text>Add content</Text>}
      />,
    )

    expect(lastFrame()).toContain('No lessons yet')
    expect(lastFrame()).toContain('Import a content pack to get started.')
    expect(lastFrame()).toContain('Try eng content import ./packs/b1-core')
    expect(lastFrame()).toContain('Add content')
  })

  it('omits hint and action when not provided', () => {
    const { lastFrame } = renderInTheme(
      <EmptyState
        title="No drills available"
        description="Come back after generating a study plan."
      />,
    )

    expect(lastFrame()).toContain('No drills available')
    expect(lastFrame()).toContain('Come back after generating a study plan.')
    expect(lastFrame()).not.toContain('Try eng content import ./packs/b1-core')
    expect(lastFrame()).not.toContain('Add content')
  })

  it('renders without crashing', () => {
    expect(() => {
      renderInTheme(
        <EmptyState
          title="Nothing to review"
          description="You are all caught up for today."
        />,
      )
    }).not.toThrow()
  })
})
