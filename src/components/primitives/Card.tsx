import type { ReactNode } from 'react'
import { Box } from 'ink'
import type { Boxes } from 'cli-boxes'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface CardProps {
  children: ReactNode
  variant?: 'default' | 'elevated'
}

export function Card({ children, variant = 'default' }: CardProps) {
  const theme = useTheme()
  const borderStyle = theme.borderStyles.card as keyof Boxes

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={
        variant === 'elevated'
          ? theme.colors.focus.active
          : theme.colors.border.default
      }
      flexDirection="column"
      paddingX={theme.spacing.md}
      paddingY={theme.spacing.sm}
    >
      {children}
    </Box>
  )
}
