import { Box } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

export interface SpacerProps {
  size?: 'sm' | 'md' | 'lg'
}

export function Spacer({ size = 'md' }: SpacerProps) {
  const theme = useTheme()
  return <Box height={theme.spacing[size]} />
}
