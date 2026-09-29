import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface DividerProps {
  label?: string
}

export function Divider({ label }: DividerProps) {
  const theme = useTheme()

  if (label != null) {
    return (
      <Box>
        <Text color={theme.colors.text.muted}>{'\u2500'.repeat(2)} {label} {'\u2500'.repeat(2)}</Text>
      </Box>
    )
  }

  return (
    <Box>
      <Text color={theme.colors.text.muted}>{'\u2500'.repeat(28)}</Text>
    </Box>
  )
}
