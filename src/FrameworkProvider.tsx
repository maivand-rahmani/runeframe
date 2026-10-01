import type { ReactNode } from 'react'
import { ThemeProvider } from './design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from './interaction/keyboard/KeyboardScopeProvider.js'
import { FocusTreeProvider } from './interaction/focus/FocusTreeProvider.js'
import { ScopedActionRegistryProvider } from './commands/actions/ScopedActionRegistryProvider.js'
import {
  NavigationProvider,
  type NavigationProviderProps,
} from './navigation/NavigationProvider.js'
import {
  MouseProvider,
  type MouseDiagnosticEvent,
} from './interaction/mouse/MouseProvider.js'
import type { MouseEventSource } from './interaction/mouse/MouseEventSource.js'
import { ModalProvider } from './components/overlays/ModalProvider.js'
import { ToastProvider } from './components/feedback/ToastProvider.js'
import type { ThemeMode, ThemeOverrides } from './types.js'

export interface FrameworkProviderProps
  extends Pick<NavigationProviderProps, 'registry' | 'defaultScreen'> {
  children: ReactNode
  themeMode?: ThemeMode
  /**
   * Deep-partial theme overrides applied to the provider-level
   * `ThemeProvider`. Nested providers deep-merge on top of inherited values.
   */
  theme?: ThemeOverrides
  onModalClose?: () => void
  /**
   * Optional opt-in mouse routing diagnostics forwarded to `MouseProvider`.
   * When omitted nothing is reported; no platform coupling and no behavior
   * change. Intended for a host-owned diagnostics sink.
   */
  mouseDiagnostics?: (event: MouseDiagnosticEvent) => void
  /**
   * Optional normalized mouse event source forwarded to `MouseProvider`.
   * When provided, mouse routing consumes that channel and the legacy
   * post-Ink SGR interceptor is disabled so a report seen on both transports
   * dispatches exactly once. When omitted, behavior is unchanged.
   */
  mouseEventSource?: MouseEventSource
}

/**
 * Complete default composition for a Runeframe application.
 *
 * Provider order (outermost → innermost):
 * Theme → keyboard dispatch → focus tree → scoped actions → navigation →
 * mouse registry → toast host → modal host → children.
 *
 * Every capability is always enabled: focus tree, scoped action registry,
 * navigation, mouse areas, modals and toasts. There are no opt-in
 * composition flags. Toast stays outside Modal so its host remains mounted
 * when modal content replaces children; MouseProvider wraps both so
 * modal-rendered screens are inside the mouse registry.
 */
export function FrameworkProvider({
  children,
  registry,
  defaultScreen,
  themeMode,
  theme,
  onModalClose,
  mouseDiagnostics,
  mouseEventSource,
}: FrameworkProviderProps) {
  return (
    <ThemeProvider mode={themeMode} theme={theme}>
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <ScopedActionRegistryProvider>
            <NavigationProvider
              registry={registry}
              defaultScreen={defaultScreen}
            >
              <MouseProvider
                diagnostics={mouseDiagnostics}
                mouseEventSource={mouseEventSource}
              >
                <ToastProvider>
                  <ModalProvider onClose={onModalClose}>
                    {children}
                  </ModalProvider>
                </ToastProvider>
              </MouseProvider>
            </NavigationProvider>
          </ScopedActionRegistryProvider>
        </FocusTreeProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>
  )
}
