import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from './themeOverrides.js'

export interface DividerProps {
  label?: string
}

export function Divider({ label }: DividerProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'divider')
  const horizontal =
    overrides?.symbols?.horizontal ??
    theme.symbols?.divider.horizontal ??
    '\u2500'
  const color = overrides?.colors?.default ?? theme.colors.text.muted
  const width = Math.max(
    0,
    componentLayoutNumber(
      theme,
      'divider',
      'width',
      theme.layout?.dividerWidth ?? 28,
    ),
  )
  const labelPadding = Math.max(
    0,
    componentLayoutNumber(theme, 'divider', 'labelPadding', 2),
  )

  if (label != null) {
    return (
      <Box>
        <Text color={color}>
          {horizontal.repeat(labelPadding)} {label}{' '}
          {horizontal.repeat(labelPadding)}
        </Text>
      </Box>
    )
  }

  return (
    <Box>
      <Text color={color}>{horizontal.repeat(width)}</Text>
    </Box>
  )
}
