import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import type { Boxes } from 'cli-boxes'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface PanelProps {
  title?: string
  children: ReactNode
}

export function Panel({ title, children }: PanelProps) {
  const theme = useTheme()
  const borderStyle = theme.borderStyles.panel as keyof Boxes

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={theme.colors.border.default}
      flexDirection="column"
      paddingX={theme.spacing.sm}
    >
      {title != null && (
        <Box marginBottom={theme.spacing.xs}>
          <Text bold>{title}</Text>
        </Box>
      )}
      {children}
    </Box>
  )
}
