import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

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
  const overrides = componentOverrides(theme, 'topBar')
  const narrowColumns = componentLayoutNumber(
    theme,
    'topBar',
    'narrowColumns',
    theme.layout?.narrowColumns ?? LAYOUT.narrow,
  )
  const separator = overrides?.symbols?.separator ?? '\u2014'
  const isCompact = columns < narrowColumns

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box>
        <Text
          bold
          color={overrides?.colors?.appName ?? theme.colors.text.primary}
        >
          {appName}
        </Text>
        {screenTitle != null && !isCompact && (
          <Text
            color={overrides?.colors?.screenTitle ?? theme.colors.text.secondary}
          >
            {' '}
            {separator}
            {' '}
            {screenTitle}
          </Text>
        )}
      </Box>

      {!isCompact && (
        <Box>
          <Text color={overrides?.colors?.date ?? theme.colors.text.muted}>
            {formatDate()}
          </Text>
        </Box>
      )}
    </Box>
  )
}
