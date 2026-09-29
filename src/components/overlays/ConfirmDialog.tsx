import { useState, useCallback, useRef } from 'react'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { ConfirmModal } from './ConfirmModal.js'

export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message: string
  onConfirm: () => void
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  message,
  onConfirm,
  confirmLabel,
  cancelLabel,
  danger,
}: ConfirmDialogProps) {
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useKeyHandler(
    (event) => {
      if (event.enter) {
        onConfirmRef.current()
        onCloseRef.current()
        return true
      }
      if (event.escape) {
        onCloseRef.current()
        return true
      }
    },
    'modal',
    { enabled: isOpen, priority: 200 },
  )

  if (!isOpen) return null

  return (
    <ConfirmModal
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={() => {
        onConfirm()
        onClose()
      }}
      onCancel={onClose}
      danger={danger}
    />
  )
}

export interface UseConfirmDialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
}

export interface UseConfirmDialogResult {
  isOpen: boolean
  open: () => void
  close: () => void
  confirm: () => void
  setMessage: (message: string) => void
  message: string
}

export function useConfirmDialog(
  options: UseConfirmDialogOptions,
): UseConfirmDialogResult {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState(options.message)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const confirm = useCallback(() => {
    optionsRef.current.onConfirm()
    setIsOpen(false)
  }, [])

  return { isOpen, open, close, confirm, setMessage, message }
}
