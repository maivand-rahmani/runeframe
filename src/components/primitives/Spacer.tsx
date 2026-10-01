import { Box } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from './themeOverrides.js'

export interface SpacerProps {
  size?: 'sm' | 'md' | 'lg'
}

export function Spacer({ size = 'md' }: SpacerProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'spacer')
  return <Box height={overrides?.spacing?.[size] ?? theme.spacing[size]} />
}
