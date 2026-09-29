import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'

// ── Types ──

export type ToastVariant = 'success' | 'warning' | 'error' | 'info'

export interface Toast {
  id: string
  variant: ToastVariant
  message: string
  timeout?: number
}

export interface ToastResult {
  id: string
  dismiss: () => void
}

export interface ToastContextValue {
  toast: (
    variant: ToastVariant,
    message: string,
    timeout?: number,
  ) => ToastResult
}

// ── Context ──

const ToastContext = createContext<ToastContextValue | null>(null)

// ── Provider ──

export interface ToastProviderProps {
  children: ReactNode
}

const MAX_VISIBLE_TOASTS = 3

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idCounter = useRef(0)
  const { colors } = useTheme()

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (
      variant: ToastVariant,
      message: string,
      timeout?: number,
    ): ToastResult => {
      const id = String(++idCounter.current)

      setToasts((prev) => {
        const next = [...prev, { id, variant, message, timeout }]
        if (next.length > MAX_VISIBLE_TOASTS) {
          return next.slice(-MAX_VISIBLE_TOASTS)
        }
        return next
      })

      let timeoutId: ReturnType<typeof setTimeout> | undefined

      if (timeout !== undefined && timeout > 0) {
        timeoutId = setTimeout(() => {
          removeToast(id)
        }, timeout)
      }

      return {
        id,
        dismiss: () => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId)
          }
          removeToast(id)
        },
      }
    },
    [removeToast],
  )

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {toasts.length > 0 && (
        <Box flexDirection="column">
          {toasts.map((t) => (
            <Box key={t.id}>
              <Text color={colors.status[t.variant]}>{t.message}</Text>
            </Box>
          ))}
        </Box>
      )}
      {children}
    </ToastContext.Provider>
  )
}

// ── Hook ──

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}
