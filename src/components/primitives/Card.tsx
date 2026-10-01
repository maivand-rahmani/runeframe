import type { ReactNode } from 'react'
import { Box } from 'ink'
import type { Boxes } from 'cli-boxes'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from './themeOverrides.js'

export interface CardProps {
  children: ReactNode
  variant?: 'default' | 'elevated'
}

export function Card({ children, variant = 'default' }: CardProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'card')
  const borderStyle = (overrides?.borderStyle ??
    theme.borderStyles.card) as keyof Boxes

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={
        variant === 'elevated'
          ? overrides?.colors?.elevated ?? theme.colors.focus.active
          : overrides?.colors?.border ?? theme.colors.border.default
      }
      flexDirection="column"
      paddingX={overrides?.spacing?.paddingX ?? theme.spacing.md}
      paddingY={overrides?.spacing?.paddingY ?? theme.spacing.sm}
    >
      {children}
    </Box>
  )
}
