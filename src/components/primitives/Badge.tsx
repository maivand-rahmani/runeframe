import type { ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import type { ThemeTokens } from '../../types.js'
import { componentOverrides } from './themeOverrides.js'

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export interface BadgeProps {
  variant: BadgeVariant
  children: ReactNode
  compact?: boolean
}

export function resolveBadgeColor(
  theme: ThemeTokens,
  variant: BadgeVariant,
): string {
  const overrides = componentOverrides(theme, 'badge')

  switch (variant) {
    case 'success':
      return overrides?.colors?.success ?? theme.colors.status.success
    case 'warning':
      return overrides?.colors?.warning ?? theme.colors.status.warning
    case 'error':
      return overrides?.colors?.error ?? theme.colors.status.error
    case 'info':
      return overrides?.colors?.info ?? theme.colors.status.info
    case 'neutral':
    default:
      return overrides?.colors?.neutral ?? theme.colors.text.secondary
  }
}

export function Badge({ variant, children, compact = false }: BadgeProps) {
  const theme = useTheme()
  const color = resolveBadgeColor(theme, variant)
  const overrides = componentOverrides(theme, 'badge')
  const openSymbol =
    overrides?.symbols?.open ?? theme.symbols?.badge.open ?? '['
  const closeSymbol =
    overrides?.symbols?.close ?? theme.symbols?.badge.close ?? ']'

  return (
    <Text color={color}>
      {compact ? (
        children
      ) : (
        <>
          {openSymbol}
          {children}
          {closeSymbol}
        </>
      )}
    </Text>
  )
}
