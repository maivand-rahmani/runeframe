import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'

export interface TopBarProps {
  appName: string
  screenTitle?: string
  columns?: number
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function TopBar({
  appName,
  screenTitle,
  columns = LAYOUT.narrow + 1,
}: TopBarProps) {
  const theme = useTheme()
  const isCompact = columns < LAYOUT.narrow

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box>
        <Text bold color={theme.colors.text.primary}>
          {appName}
        </Text>
        {screenTitle != null && !isCompact && (
          <Text color={theme.colors.text.secondary}>
            {' \u2014 '}
            {screenTitle}
          </Text>
        )}
      </Box>

      {!isCompact && (
        <Box>
          <Text color={theme.colors.text.muted}>{formatDate()}</Text>
        </Box>
      )}
    </Box>
  )
}
