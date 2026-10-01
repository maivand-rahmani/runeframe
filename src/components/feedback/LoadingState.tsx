import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'

export interface LoadingStateProps {
  label: string
  detail?: string
}

export function LoadingState({ label, detail }: LoadingStateProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'loadingState')
  const message = detail
    ? `Loading ${label}... (${detail})`
    : `Loading ${label}...`

  return (
    <Text color={overrides?.colors?.text ?? theme.colors.text.muted}>
      {message}
    </Text>
  )
}
