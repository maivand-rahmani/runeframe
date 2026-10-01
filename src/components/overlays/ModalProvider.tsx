import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import { Text, type BoxProps } from 'ink'
import { useNavigation } from '../../navigation/NavigationProvider.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useKeyboardScope } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

export interface ModalProviderProps {
  children: ReactNode
  onClose?: () => void
}

export function ModalProvider({ children, onClose }: ModalProviderProps) {
  const {
    isModalOpen,
    currentModal,
    currentModalProps,
    modalStack,
    popModal,
  } = useNavigation()
  const { pushScope, popScope, isScopeActive } = useKeyboardScope()
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'modal')
  const frameBorderStyle = (overrides?.borderStyle ??
    theme.layout?.modalBorderStyle ??
    theme.borderStyles.modal ??
    'round') as BoxProps['borderStyle']
  const frameBorderColor = overrides?.colors?.border ?? theme.colors.focus.ring
  const paddingX =
    overrides?.spacing?.paddingX ??
    componentLayoutNumber(
      theme,
      'modal',
      'paddingX',
      theme.layout?.modalPaddingX ?? 1,
    )
  const paddingY =
    overrides?.spacing?.paddingY ??
    componentLayoutNumber(
      theme,
      'modal',
      'paddingY',
      theme.layout?.modalPaddingY ?? 1,
    )
  const topPadding = Math.max(
    0,
    componentLayoutNumber(theme, 'modal', 'topPadding', 2),
  )
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
    <MouseLayout flexDirection="column" width="100%">
      <MouseLayout>
        <Text dimColor>{' '.repeat(topPadding)}</Text>
      </MouseLayout>
      <MouseLayout flexDirection="column" alignItems="center" justifyContent="center">
        <MouseLayout
          borderStyle={frameBorderStyle}
          borderColor={frameBorderColor}
          paddingX={paddingX}
          paddingY={paddingY}
        >
          {currentModal.component({
            params: {},
            modalProps: currentModalProps,
            closeModal: popModal,
          })}
        </MouseLayout>
      </MouseLayout>
      {modalStack.length > 1 && (
        <MouseLayout>
          <Text dimColor>
            {modalStack.length - 1} more modal
            {modalStack.length > 2 ? 's' : ''}
          </Text>
        </MouseLayout>
      )}
    </MouseLayout>
  )
}

export function useModal() {
  const { pushModal, popModal, isModalOpen, currentModal } = useNavigation()

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
