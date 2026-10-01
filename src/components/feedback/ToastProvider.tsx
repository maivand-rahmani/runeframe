import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

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
  /**
   * Number of physical terminal rows the toast host currently occupies.
   *
   * A consumer rendering a fixed-height shell reserves this many rows so the
   * total frame never grows past the physical terminal (which would scroll it
   * and drift mouse hitboxes).
   */
  readonly visibleRows: number
}

// ── Context ──

const ToastContext = createContext<ToastContextValue | null>(null)

// ── Provider ──

export interface ToastProviderProps {
  children: ReactNode
}

const MAX_VISIBLE_TOASTS = 3
const FALLBACK_ROWS = 24
const FALLBACK_COLUMNS = 80

// A toast must always occupy exactly one physical row: collapse line breaks
// so the rendered message can never expand into multiple terminal rows.
function toSingleLine(message: string): string {
  return message.replace(/\r\n|\r|\n/g, ' ')
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idCounter = useRef(0)
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'toast')
  const maxVisibleToasts = Math.max(
    0,
    componentLayoutNumber(theme, 'toast', 'maxVisible', MAX_VISIBLE_TOASTS),
  )
  const reservedRows = Math.max(
    0,
    componentLayoutNumber(theme, 'toast', 'reservedRows', 1),
  )
  const { columns: detectedColumns, rows: detectedRows } = useWindowSize()

  const terminalRows =
    typeof detectedRows === 'number' && detectedRows > 0
      ? detectedRows
      : FALLBACK_ROWS
  const terminalColumns =
    typeof detectedColumns === 'number' && detectedColumns > 0
      ? detectedColumns
      : FALLBACK_COLUMNS

  // Keep one terminal row free for the shell below: the host may occupy at
  // most rows - 1 physical lines, and never more than the existing stack cap.
  const maxVisibleRows = Math.max(0, terminalRows - reservedRows)
  const visibleCount = Math.min(maxVisibleToasts, maxVisibleRows)
  const visibleToasts =
    visibleCount > 0
      ? toasts.slice(Math.max(0, toasts.length - visibleCount))
      : []
  const visibleRows = visibleToasts.length

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
        if (maxVisibleToasts === 0) {
          return []
        }
        const next = [...prev, { id, variant, message, timeout }]
        if (next.length > maxVisibleToasts) {
          return next.slice(-maxVisibleToasts)
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
    [removeToast, maxVisibleToasts],
  )

  const contextValue = useMemo<ToastContextValue>(
    () => ({ toast: addToast, visibleRows }),
    [addToast, visibleRows],
  )

  return (
    <ToastContext.Provider value={contextValue}>
      {visibleToasts.length > 0 && (
        <Box flexDirection="column">
          {visibleToasts.map((t) => (
            <Box key={t.id} width={terminalColumns}>
              <Text
                color={
                  overrides?.colors?.[t.variant] ??
                  theme.colors.status[t.variant]
                }
                wrap="truncate"
              >
                {toSingleLine(t.message)}
              </Text>
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

/**
 * Rows the nearest toast host currently reserves above its children.
 *
 * Returns 0 outside a `ToastProvider`, so shells can call it unconditionally
 * and reserve nothing when no host is mounted.
 */
export function useToastVisibleRows(): number {
  const ctx = useContext(ToastContext)
  return ctx ? ctx.visibleRows : 0
}
