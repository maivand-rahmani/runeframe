import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import type { Boxes } from 'cli-boxes'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from './themeOverrides.js'

export interface PanelProps {
  title?: string
  children: ReactNode
}

export function Panel({ title, children }: PanelProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'panel')
  const borderStyle = (overrides?.borderStyle ??
    theme.borderStyles.panel) as keyof Boxes

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={overrides?.colors?.border ?? theme.colors.border.default}
      flexDirection="column"
      paddingX={overrides?.spacing?.paddingX ?? theme.spacing.sm}
    >
      {title != null && (
        <Box
          marginBottom={
            overrides?.spacing?.titleMarginBottom ?? theme.spacing.xs
          }
        >
          <Text bold>{title}</Text>
        </Box>
      )}
      {children}
    </Box>
  )
}
