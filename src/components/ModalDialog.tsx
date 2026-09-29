import { useEffect, useRef, type ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'
import type { Action } from '../commands/ActionRegistry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/MouseProvider.js'

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
  const ref = useAutoMouseArea({ disabled, onClick })
  return (
    <MouseLayout ref={ref} flexDirection="row">
      {children}
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
  const { colors } = useTheme()
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
      borderStyle="round"
      borderColor={colors.focus.ring}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      width={width}
    >
      <Text bold color={colors.focus.active}>
        {title}
      </Text>
      <MouseLayout marginY={1}>{children}</MouseLayout>
      {footer && footer.length > 0 && (
        <MouseLayout marginTop={1}>
          {footer.map((action, idx) => (
            <FooterMouseTarget
              key={action.id}
              action={action}
              onClick={() => {
                if (isActionEnabled(action)) action.handler()
              }}
            >
              <Text>
                {idx > 0 && <Text>  </Text>}
                {action.keys && action.keys.length > 0 && (
                  <Text color={colors.focus.active}>
                    [{action.keys[0]}]
                  </Text>
                )}
                <Text> </Text>
                <Text>{action.label}</Text>
              </Text>
            </FooterMouseTarget>
          ))}
        </MouseLayout>
      )}
    </MouseLayout>
  )
}
