import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import {
  borderStyles,
  semanticColors,
  spacing,
  typography,
} from '../../design-system/tokens.js'
import type { ThemeTokens } from '../../types.js'
import { Badge, resolveBadgeColor } from './Badge.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const theme: ThemeTokens = {
  colors: {
    text: { ...semanticColors.text },
    status: { ...semanticColors.status },
    focus: { ...semanticColors.focus },
    surface: { ...semanticColors.surface },
    border: { ...semanticColors.border },
  },
  spacing: { ...spacing },
  typography: { ...typography },
  borderStyles: { ...borderStyles },
}

describe('Badge', () => {
  it('renders semantic variants', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="error">Error</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="neutral">Neutral</Badge>
      </>,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('[Success]')
    expect(frame).toContain('[Warning]')
    expect(frame).toContain('[Error]')
    expect(frame).toContain('[Info]')
    expect(frame).toContain('[Neutral]')
  })

  it('renders compact mode without brackets', () => {
    const { lastFrame } = renderInTheme(
      <Badge variant="success" compact>
        Compact
      </Badge>,
    )

    expect(lastFrame()).toContain('Compact')
    expect(lastFrame()).not.toContain('[Compact]')
  })

  it('maps badge variants to semantic token colors', () => {
    expect(resolveBadgeColor(theme, 'success')).toBe(theme.colors.status.success)
    expect(resolveBadgeColor(theme, 'warning')).toBe(theme.colors.status.warning)
    expect(resolveBadgeColor(theme, 'error')).toBe(theme.colors.status.error)
    expect(resolveBadgeColor(theme, 'info')).toBe(theme.colors.status.info)
    expect(resolveBadgeColor(theme, 'neutral')).toBe(theme.colors.text.secondary)
  })
})
