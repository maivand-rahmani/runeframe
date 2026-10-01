import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface LoadingStateProps {
  label: string
  detail?: string
}

export function LoadingState({ label, detail }: LoadingStateProps) {
  const theme = useTheme()
  const message = detail
    ? `Loading ${label}... (${detail})`
    : `Loading ${label}...`

  return <Text color={theme.colors.text.muted}>{message}</Text>
}
