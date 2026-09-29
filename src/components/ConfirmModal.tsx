import type { ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/MouseProvider.js'

function ConfirmChoices({
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  activeColor,
}: {
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
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
        <Text color={activeColor}>[{confirmLabel}]</Text>
        <Text dimColor> / </Text>
        <Text dimColor>[{cancelLabel}]</Text>
      </Text>
    )
  }

  return (
    <MouseLayout flexDirection="row">
      <MeasuredAction onClick={onConfirm}>
        <Text color={activeColor}>[{confirmLabel}]</Text>
      </MeasuredAction>
      <Text dimColor> / </Text>
      <MeasuredAction onClick={onCancel}>
        <Text dimColor>[{cancelLabel}]</Text>
      </MeasuredAction>
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

export interface ConfirmModalProps {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export function ConfirmModal({
  title = 'Confirm',
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
  danger,
}: ConfirmModalProps) {
  const { colors } = useTheme()

  return (
    <>
      <Text bold color={danger ? colors.status.error : colors.focus.active}>
        {title}
      </Text>
      <Text>{message}</Text>
      <ConfirmChoices
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
        activeColor={colors.focus.active}
      />
    </>
  )
}
