import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'
import { ScopedActionRegistryProvider } from '../../commands/actions/ScopedActionRegistryProvider.js'
import { ActionRegistry } from '../../commands/actions/ActionRegistry.js'
import { HotkeyHintBar } from '../../commands/ui/HotkeyHintBar.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

export interface StatusBarProps {
  mode?: string
  columns?: number
  /** Optional — when provided, auto-generates footer hints from the action registry. */
  registry?: ActionRegistry
}

export function StatusBar({
  mode,
  columns = LAYOUT.narrow + 1,
  registry,
}: StatusBarProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'statusBar')
  const narrowColumns = componentLayoutNumber(
    theme,
    'statusBar',
    'narrowColumns',
    theme.layout?.narrowColumns ?? LAYOUT.narrow,
  )
  const isCompact = columns < narrowColumns

  const hasMode = mode != null
  const hasRegistry = registry != null

  if (!hasMode && !hasRegistry) {
    return null
  }

  const registryHints = hasRegistry ? (
    <ScopedActionRegistryProvider registry={registry}>
      <HotkeyHintBar maxHints={isCompact ? 2 : undefined} />
    </ScopedActionRegistryProvider>
  ) : null

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box>
        {hasMode && (
          <Text color={overrides?.colors?.mode ?? theme.colors.text.muted}>
            Mode: {mode}
          </Text>
        )}
      </Box>

      <Box
        flexDirection="row"
        gap={overrides?.spacing?.gap ?? theme.spacing.sm}
      >
        {registryHints}
      </Box>
    </Box>
  )
}
