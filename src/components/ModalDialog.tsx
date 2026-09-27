import { useEffect, useRef, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'
import type { Action } from '../commands/ActionRegistry.js'

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
    <Box
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
      <Box marginY={1}>{children}</Box>
      {footer && footer.length > 0 && (
        <Box marginTop={1}>
          {footer.map((action, idx) => (
            <Text key={action.id}>
              {idx > 0 && <Text>  </Text>}
              {action.keys && action.keys.length > 0 && (
                <Text color={colors.focus.active}>
                  [{action.keys[0]}]
                </Text>
              )}
              <Text> </Text>
              <Text>{action.label}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
