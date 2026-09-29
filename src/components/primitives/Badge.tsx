import type { ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import type { ThemeTokens } from '../../types.js'

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
  switch (variant) {
    case 'success':
      return theme.colors.status.success
    case 'warning':
      return theme.colors.status.warning
    case 'error':
      return theme.colors.status.error
    case 'info':
      return theme.colors.status.info
    case 'neutral':
    default:
      return theme.colors.text.secondary
  }
}

export function Badge({ variant, children, compact = false }: BadgeProps) {
  const theme = useTheme()
  const color = resolveBadgeColor(theme, variant)

  return <Text color={color}>{compact ? children : <>[{children}]</>}</Text>
}
