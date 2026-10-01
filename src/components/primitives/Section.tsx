import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface SectionProps {
  label?: string
  children: ReactNode
}

export function Section({ label, children }: SectionProps) {
  const theme = useTheme()

  return (
    <Box flexDirection="column">
      {label != null && (
        <Box marginBottom={theme.spacing.sm}>
          <Text bold>{label}</Text>
        </Box>
      )}
      {children}
    </Box>
  )
}
