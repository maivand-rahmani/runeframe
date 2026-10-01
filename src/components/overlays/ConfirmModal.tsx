import { useState, type ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'

function ConfirmChoices({
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  activeColor,
  openSymbol,
  closeSymbol,
  separator,
}: {
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  activeColor: string
  openSymbol: string
  closeSymbol: string
  separator: string
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
        <Text color={activeColor}>
          {openSymbol}
          {confirmLabel}
          {closeSymbol}
        </Text>
        <Text dimColor>{separator}</Text>
        <Text dimColor>
          {openSymbol}
          {cancelLabel}
          {closeSymbol}
        </Text>
      </Text>
    )
  }

  return (
    <MouseLayout flexDirection="row">
      <MeasuredAction onClick={onConfirm}>
        <Text color={activeColor}>
          {openSymbol}
          {confirmLabel}
          {closeSymbol}
        </Text>
      </MeasuredAction>
      <Text dimColor>{separator}</Text>
      <MeasuredAction onClick={onCancel}>
        <Text dimColor>
          {openSymbol}
          {cancelLabel}
          {closeSymbol}
        </Text>
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
  const [hovered, setHovered] = useState(false)
  const ref = useAutoMouseArea({
    onClick,
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  return (
    <MouseLayout ref={ref} flexDirection="row">
      <Text underline={hovered}>{children}</Text>
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
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'confirmModal')
  const titleColor = danger
    ? overrides?.colors?.danger ?? colors.status.error
    : overrides?.colors?.title ?? colors.focus.active
  const confirmColor = overrides?.colors?.confirm ?? colors.focus.active
  const openSymbol = overrides?.symbols?.open ?? '['
  const closeSymbol = overrides?.symbols?.close ?? ']'
  const separator = overrides?.symbols?.separator ?? ' / '

  return (
    <>
      <Text bold color={titleColor}>
        {title}
      </Text>
      <Text>{message}</Text>
      <ConfirmChoices
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
        activeColor={confirmColor}
        openSymbol={openSymbol}
        closeSymbol={closeSymbol}
        separator={separator}
      />
    </>
  )
}
