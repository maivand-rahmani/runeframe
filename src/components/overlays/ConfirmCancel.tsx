import { useRef } from 'react'
import { Text } from 'ink'
import { ModalDialog } from './ModalDialog.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { InputConsumptionResult } from '../../types.js'
import type { Action } from '../../commands/actions/ActionRegistry.js'
import { componentOverrides } from '../primitives/themeOverrides.js'

export interface ConfirmCancelProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export function ConfirmCancel({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger,
}: ConfirmCancelProps) {
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'confirmCancel')
  const messageColor = danger
    ? overrides?.colors?.danger ?? colors.status.error
    : overrides?.colors?.message ?? colors.text.primary
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Enter confirms, Escape cancels — priority 200 (above generic modal close at 100)
  useKeyHandler(
    (event) => {
      if (event.enter) {
        onConfirmRef.current()
        return InputConsumptionResult.Consumed
      }
      if (event.escape) {
        onCancelRef.current()
        return InputConsumptionResult.Consumed
      }
    },
    'modal',
    { priority: 200 },
  )

  const footer: Action[] = [
    {
      id: 'confirm',
      label: confirmLabel,
      category: 'input',
      handler: () => onConfirmRef.current(),
      keys: ['enter'],
    },
    {
      id: 'cancel',
      label: cancelLabel,
      category: 'input',
      handler: () => onCancelRef.current(),
      keys: ['esc'],
    },
  ]

  return (
    <ModalDialog title={title} onClose={onCancel} footer={footer}>
      <Text color={messageColor}>{message}</Text>
    </ModalDialog>
  )
}
