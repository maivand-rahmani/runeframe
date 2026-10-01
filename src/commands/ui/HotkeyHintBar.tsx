import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useActiveActions } from '../actions/ScopedActionRegistryProvider.js'
import type { FocusScope } from '../../types.js'

export interface HotkeyHintBarProps {
  /** Optional scope filter — only show actions for this scope. */
  scope?: FocusScope
  /** Max hints to display (default: 8). */
  maxHints?: number
}

function resolveKey(action: {
  keys?: string[]
  shortcut?: string
}): string {
  if (action.keys && action.keys.length > 0) {
    return action.keys[0]
  }
  return action.shortcut ?? ''
}

export function HotkeyHintBar({
  scope,
  maxHints = 8,
}: HotkeyHintBarProps) {
  const theme = useTheme()
  const actions = useActiveActions()

  const filtered = scope
    ? actions.filter((a) => a.scope === scope)
    : actions

  const sorted = [...filtered].sort((a, b) => {
    const groupA = a.group ?? ''
    const groupB = b.group ?? ''
    if (groupA !== groupB) return groupA.localeCompare(groupB)
    return a.label.localeCompare(b.label)
  })

  const visible = sorted.slice(0, maxHints)

  if (visible.length === 0) {
    return null
  }

  return (
    <Box flexDirection="row" gap={theme.spacing.sm}>
      {visible.map((action) => {
        const keyLabel = resolveKey(action)
        return (
          <Text
            key={action.id}
            color={theme.colors.text.secondary}
          >
            [{keyLabel}] {action.label}
          </Text>
        )
      })}
    </Box>
  )
}
