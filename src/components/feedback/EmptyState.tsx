import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface EmptyStateProps {
  title: string
  description: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({
  title,
  description,
  hint,
  action,
}: EmptyStateProps) {
  const theme = useTheme()

  return (
    <Box flexDirection="column">
      <Box marginBottom={theme.spacing.xs}>
        <Text bold color={theme.colors.text.primary}>
          {title}
        </Text>
      </Box>

      <Text color={theme.colors.text.secondary}>{description}</Text>

      {hint != null && (
        <Box marginTop={theme.spacing.xs}>
          <Text color={theme.colors.text.muted} italic>
            {hint}
          </Text>
        </Box>
      )}

      {action != null && <Box marginTop={theme.spacing.sm}>{action}</Box>}
    </Box>
  )
}
