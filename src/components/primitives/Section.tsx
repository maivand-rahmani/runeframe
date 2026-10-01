import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from './themeOverrides.js'

export interface SectionProps {
  label?: string
  children: ReactNode
}

export function Section({ label, children }: SectionProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'section')

  return (
    <Box flexDirection="column">
      {label != null && (
        <Box
          marginBottom={
            overrides?.spacing?.labelMarginBottom ?? theme.spacing.sm
          }
        >
          <Text bold color={overrides?.colors?.label}>
            {label}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  )
}
