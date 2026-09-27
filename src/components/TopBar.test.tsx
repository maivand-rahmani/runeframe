import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { TopBar } from './TopBar.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const FROZEN_DATE = new Date('2026-05-10T12:00:00Z')

describe('TopBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_DATE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders app name', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" columns={100} />,
    )
    expect(lastFrame()).toContain('Runeframe')
  })

  it('renders screen title when provided', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" screenTitle="Dashboard" columns={100} />,
    )
    expect(lastFrame()).toContain('Runeframe')
    expect(lastFrame()).toContain('Dashboard')
  })

  it('renders without screen title', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" columns={100} />,
    )
    expect(lastFrame()).toContain('Runeframe')
    expect(lastFrame()).not.toContain('\u2014')
  })

  it('compact mode shows only app name', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" screenTitle="Dashboard" columns={70} />,
    )
    expect(lastFrame()).toContain('Runeframe')
    expect(lastFrame()).not.toContain('Dashboard')
  })

  it('full mode shows app name and screen title', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" screenTitle="Reports" columns={120} />,
    )
    expect(lastFrame()).toContain('Runeframe')
    expect(lastFrame()).toContain('Reports')
  })

  it('uses theme tokens for text colors', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="MyApp" screenTitle="Home" columns={100} />,
    )
    expect(lastFrame()).toContain('MyApp')
    expect(lastFrame()).toContain('Home')
  })

  it('renders date in the output', () => {
    const { lastFrame } = renderInTheme(
      <TopBar appName="Runeframe" columns={100} />,
    )
    expect(lastFrame()).toContain('2026')
  })
})
