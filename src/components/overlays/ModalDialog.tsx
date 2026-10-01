import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Text, type BoxProps } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useShellSuspension } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { InputConsumptionResult } from '../../types.js'
import type { Action } from '../../commands/actions/ActionRegistry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

function isActionEnabled(action: Action): boolean {
  if (action.enabled === undefined) return true
  return typeof action.enabled === 'function'
    ? action.enabled()
    : action.enabled
}

function FooterMouseTarget({
  action,
  onClick,
  children,
}: {
  action: Action
  onClick: () => void
  children: ReactNode
}) {
  const geometry = useMouseGeometry()
  const registry = useMouseRegistry()
  const hasMeasuredMouseHost =
    geometry !== null &&
    geometry.origin !== null &&
    geometry.clip !== null &&
    registry !== null

  if (!hasMeasuredMouseHost) return children

  return (
    <MeasuredFooterAction
      disabled={!isActionEnabled(action)}
      onClick={onClick}
    >
      {children}
    </MeasuredFooterAction>
  )
}

function MeasuredFooterAction({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const ref = useAutoMouseArea({
    disabled,
    onClick,
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  return (
    <MouseLayout ref={ref} flexDirection="row">
      <Text underline={hovered && !disabled}>{children}</Text>
    </MouseLayout>
  )
}

export interface ModalDialogProps {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: Action[]
  trapFocus?: boolean
  width?: number
}

export function ModalDialog({
  title,
  children,
  onClose,
  footer,
  trapFocus = true,
  width,
}: ModalDialogProps) {
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'modalDialog')
  const borderStyle = (overrides?.borderStyle ??
    theme.layout?.modalBorderStyle ??
    theme.borderStyles.modal ??
    'round') as BoxProps['borderStyle']
  const borderColor = overrides?.colors?.border ?? colors.focus.ring
  const titleColor = overrides?.colors?.title ?? colors.focus.active
  const keyColor = overrides?.colors?.key ?? colors.focus.active
  const keyOpen = overrides?.symbols?.keyOpen ?? '['
  const keyClose = overrides?.symbols?.keyClose ?? ']'
  const paddingX =
    overrides?.spacing?.paddingX ??
    componentLayoutNumber(
      theme,
      'modalDialog',
      'paddingX',
      theme.layout?.modalPaddingX ?? 1,
    )
  const paddingY =
    overrides?.spacing?.paddingY ??
    componentLayoutNumber(
      theme,
      'modalDialog',
      'paddingY',
      theme.layout?.modalPaddingY ?? 1,
    )
  const bodyMarginY =
    overrides?.spacing?.bodyMarginY ??
    componentLayoutNumber(
      theme,
      'modalDialog',
      'bodyMarginY',
      theme.layout?.modalMarginY ?? 1,
    )
  const footerMarginTop =
    overrides?.spacing?.footerMarginTop ??
    componentLayoutNumber(
      theme,
      'modalDialog',
      'footerMarginTop',
      theme.layout?.modalMarginY ?? 1,
    )
  const footerGap = Math.max(
    0,
    overrides?.spacing?.footerGap ??
      componentLayoutNumber(theme, 'modalDialog', 'footerGap', 2),
  )
  const keyLabelGap = Math.max(0, overrides?.spacing?.keyLabelGap ?? 1)
  const { suspend, restore } = useShellSuspension()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (trapFocus) {
      suspend()
      return () => restore()
    }
  }, [trapFocus, suspend, restore])

  useKeyHandler(
    (event) => {
      if (event.escape) {
        onCloseRef.current()
        return InputConsumptionResult.Consumed
      }
    },
    'modal',
    { priority: 100 },
  )

  return (
    <MouseLayout
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={paddingX}
      paddingY={paddingY}
      flexDirection="column"
      width={width}
    >
      <Text bold color={titleColor}>
        {title}
      </Text>
      <MouseLayout marginY={bodyMarginY}>{children}</MouseLayout>
      {footer && footer.length > 0 && (
        <MouseLayout marginTop={footerMarginTop}>
          {footer.map((action, idx) => (
            <FooterMouseTarget
              key={action.id}
              action={action}
              onClick={() => {
                if (isActionEnabled(action)) action.handler()
              }}
            >
              <Text>
                {idx > 0 && <Text>{' '.repeat(footerGap)}</Text>}
                {action.keys && action.keys.length > 0 && (
                  <Text color={keyColor}>
                    {keyOpen}
                    {action.keys[0]}
                    {keyClose}
                  </Text>
                )}
                <Text>{' '.repeat(keyLabelGap)}</Text>
                <Text>{action.label}</Text>
              </Text>
            </FooterMouseTarget>
          ))}
        </MouseLayout>
      )}
    </MouseLayout>
  )
}
