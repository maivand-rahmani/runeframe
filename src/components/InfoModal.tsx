import type { ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/MouseProvider.js'

function DismissAction({
  dismissLabel,
  onDismiss,
  activeColor,
}: {
  dismissLabel: string
  onDismiss: () => void
  activeColor: string
}) {
  const geometry = useMouseGeometry()
  const registry = useMouseRegistry()
  const hasMeasuredMouseHost =
    geometry !== null &&
    geometry.origin !== null &&
    geometry.clip !== null &&
    registry !== null

  if (!hasMeasuredMouseHost) {
    return (
      <Text>
        <Text color={activeColor}>[{dismissLabel}]</Text>
        <Text dimColor> — Press Enter or Escape</Text>
      </Text>
    )
  }

  return (
    <MouseLayout flexDirection="row">
      <MeasuredAction onClick={onDismiss}>
        <Text color={activeColor}>[{dismissLabel}]</Text>
      </MeasuredAction>
      <Text dimColor> — Press Enter or Escape</Text>
    </MouseLayout>
  )
}

function MeasuredAction({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  const ref = useAutoMouseArea({ onClick })
  return (
    <MouseLayout ref={ref} flexDirection="row">
      {children}
    </MouseLayout>
  )
}

export interface InfoModalProps {
  title?: string
  message: string
  details?: string
  dismissLabel?: string
  onDismiss: () => void
}

export function InfoModal({
  title = 'Info',
  message,
  details,
  dismissLabel = 'OK',
  onDismiss,
}: InfoModalProps) {
  const { colors } = useTheme()

  return (
    <>
      <Text bold color={colors.focus.active}>
        {title}
      </Text>
      <Text>{message}</Text>
      {details && <Text dimColor>{details}</Text>}
      <DismissAction
        dismissLabel={dismissLabel}
        onDismiss={onDismiss}
        activeColor={colors.focus.active}
      />
    </>
  )
}
