import { useState, type ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'

function DismissAction({
  dismissLabel,
  onDismiss,
  activeColor,
  openSymbol,
  closeSymbol,
  dismissHint,
}: {
  dismissLabel: string
  onDismiss: () => void
  activeColor: string
  openSymbol: string
  closeSymbol: string
  dismissHint: string
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
          {dismissLabel}
          {closeSymbol}
        </Text>
        <Text dimColor>{dismissHint}</Text>
      </Text>
    )
  }

  return (
    <MouseLayout flexDirection="row">
      <MeasuredAction onClick={onDismiss}>
        <Text color={activeColor}>
          {openSymbol}
          {dismissLabel}
          {closeSymbol}
        </Text>
      </MeasuredAction>
      <Text dimColor>{dismissHint}</Text>
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
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'infoModal')
  const titleColor = overrides?.colors?.title ?? colors.focus.active
  const dismissColor = overrides?.colors?.dismiss ?? colors.focus.active
  const openSymbol = overrides?.symbols?.open ?? '['
  const closeSymbol = overrides?.symbols?.close ?? ']'
  const dismissHint =
    overrides?.symbols?.dismissHint ?? ' \u2014 Press Enter or Escape'

  return (
    <>
      <Text bold color={titleColor}>
        {title}
      </Text>
      <Text>{message}</Text>
      {details && <Text dimColor>{details}</Text>}
      <DismissAction
        dismissLabel={dismissLabel}
        onDismiss={onDismiss}
        activeColor={dismissColor}
        openSymbol={openSymbol}
        closeSymbol={closeSymbol}
        dismissHint={dismissHint}
      />
    </>
  )
}
