import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import {
  useModalActions,
  useModalState,
} from '../navigation/NavigationProvider.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useKeyboardScope } from '../interaction/KeyboardScopeProvider.js'

export interface ModalProviderProps {
  children: ReactNode
  onClose?: () => void
}

export function ModalProvider({ children, onClose }: ModalProviderProps) {
  const { isModalOpen, currentModal, currentModalProps, modalStack } = useModalState()
  const { popModal } = useModalActions()
  const { pushScope, popScope, isScopeActive } = useKeyboardScope()
  const { colors } = useTheme()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const modalScopeActive = isScopeActive('modal')
    if (isModalOpen && !modalScopeActive) {
      pushScope('modal')
      return
    }

    if (!isModalOpen && modalScopeActive) {
      popScope('modal')
    }
  }, [isModalOpen, isScopeActive, popScope, pushScope])

  useKeyHandler(
    (event) => {
      if (!event.escape) return
      if (onCloseRef.current) {
        onCloseRef.current()
      }
      popModal()
      return true
    },
    'modal',
    { deps: [popModal], priority: 100 },
  )

  if (!isModalOpen || !currentModal) {
    return <>{children}</>
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text dimColor>{'  '}</Text>
      </Box>
      <Box flexDirection="column" alignItems="center" justifyContent="center">
        <Box
          borderStyle="round"
          borderColor={colors.focus.ring}
          paddingX={1}
          paddingY={1}
        >
          {currentModal.component({
            params: {},
            modalProps: currentModalProps,
            closeModal: popModal,
          })}
        </Box>
      </Box>
      {modalStack.length > 1 && (
        <Box>
          <Text dimColor>
            {modalStack.length - 1} more modal
            {modalStack.length > 2 ? 's' : ''}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export function useModal() {
  const { pushModal, popModal } = useModalActions()
  const { isModalOpen, currentModal } = useModalState()

  const openModal = useCallback(
    (screenId: string, props?: Record<string, unknown>) => {
      pushModal(screenId, props)
    },
    [pushModal],
  )

  const closeModal = useCallback(() => {
    popModal()
  }, [popModal])

  return {
    openModal,
    closeModal,
    isOpen: isModalOpen,
    currentModal,
  }
}
