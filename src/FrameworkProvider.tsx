import type { ReactNode } from 'react'
import { ThemeProvider } from './design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from './interaction/KeyboardScopeProvider.js'
import { FocusTreeProvider } from './interaction/FocusTreeProvider.js'
import { ScopedActionRegistryProvider } from './commands/ScopedActionRegistryProvider.js'
import {
  NavigationProvider,
  type NavigationProviderProps,
} from './navigation/NavigationProvider.js'
import { ModalProvider } from './components/ModalProvider.js'
import { ToastProvider } from './components/ToastProvider.js'

export interface FrameworkProviderProps
  extends Pick<NavigationProviderProps, 'registry' | 'defaultScreen'> {
  children: ReactNode
  themeMode?: 'dark' | 'light'
  onModalClose?: () => void
}

/**
 * Complete default composition for a Runeframe application.
 *
 * Provider order (outermost → innermost):
 * Theme → keyboard dispatch → focus tree → scoped actions → navigation →
 * toast host → modal host → children.
 *
 * Every capability is always enabled: focus tree, scoped action registry,
 * navigation, modals and toasts. There are no opt-in composition flags.
 */
export function FrameworkProvider({
  children,
  registry,
  defaultScreen,
  themeMode = 'dark',
  onModalClose,
}: FrameworkProviderProps) {
  return (
    <ThemeProvider mode={themeMode}>
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ScopedActionRegistryProvider>
            <NavigationProvider
              registry={registry}
              defaultScreen={defaultScreen}
            >
              <ToastProvider>
                <ModalProvider onClose={onModalClose}>
                  {children}
                </ModalProvider>
              </ToastProvider>
            </NavigationProvider>
          </ScopedActionRegistryProvider>
        </FocusTreeProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>
  )
}
