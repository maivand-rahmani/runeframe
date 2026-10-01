import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'

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
  const overrides = componentOverrides(theme, 'emptyState')

  return (
    <Box flexDirection="column">
      <Box
        marginBottom={overrides?.spacing?.titleMarginBottom ?? theme.spacing.xs}
      >
        <Text bold color={overrides?.colors?.title ?? theme.colors.text.primary}>
          {title}
        </Text>
      </Box>

      <Text color={overrides?.colors?.description ?? theme.colors.text.secondary}>
        {description}
      </Text>

      {hint != null && (
        <Box marginTop={overrides?.spacing?.hintMarginTop ?? theme.spacing.xs}>
          <Text color={overrides?.colors?.hint ?? theme.colors.text.muted} italic>
            {hint}
          </Text>
        </Box>
      )}

      {action != null && (
        <Box marginTop={overrides?.spacing?.actionMarginTop ?? theme.spacing.sm}>
          {action}
        </Box>
      )}
    </Box>
  )
}
