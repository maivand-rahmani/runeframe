import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useInput, type Key } from 'ink'
import type { FocusScope, ScopeEntry } from '../../types.js'
import { getScopePriority } from '../../constants.js'

export interface ScopedInputEvent {
  input: string
  key: Key
  scope: FocusScope
  stopPropagation: () => void
  isPropagationStopped: boolean
}

export type InputHandler = (event: ScopedInputEvent) => void | boolean

/**
 * One raw input event exactly as Ink's single `useInput` subscription
 * delivered it. Retained by interceptors so replay preserves the original
 * `(input, key)` pair instead of concatenating text.
 */
export interface RawInputEvent {
  input: string
  key: Key
}

/**
 * Runs before ordinary keyboard dispatch. Returning `true` consumes the event
 * for this subscription pass (interceptors may dispatch retained records
 * through {@link KeyboardScopeContextValue.dispatchInputEvent} themselves).
 */
export type InputInterceptor = (event: RawInputEvent) => boolean | void

interface RegisteredHandler {
  id: number
  priority: number
  handler: InputHandler
}

export interface RegisterHandlerOptions {
  priority?: number
}

export interface KeyboardScopeContextValue {
  activeScope: FocusScope
  activeScopes: FocusScope[]
  activateScope: (scope: FocusScope) => void
  pushScope: (scope: FocusScope) => void
  popScope: (scope?: FocusScope) => void
  isScopeActive: (scope: FocusScope) => boolean
  registerHandler: (
    scope: FocusScope,
    handler: InputHandler,
    options?: RegisterHandlerOptions,
  ) => () => void
  /** Suspend shell-level (navigation) keyboard shortcuts. */
  suspendShell: () => void
  /** Restore shell-level keyboard shortcuts. */
  restoreShell: () => void
  /** Whether shell shortcuts are currently suspended. */
  shellSuspended: boolean
  /**
   * @internal Register a raw-input interceptor that runs before ordinary
   * keyboard handlers. Returns an idempotent unregister function.
   */
  registerInputInterceptor: (interceptor: InputInterceptor) => () => void
  /**
   * @internal Route one retained raw input record through the ordinary
   * keyboard dispatcher, bypassing interceptors. Used to replay buffered
   * records unchanged.
   */
  dispatchInputEvent: (event: RawInputEvent) => void
}

const KeyboardScopeContext =
  createContext<KeyboardScopeContextValue | null>(null)

export interface KeyboardScopeProviderProps {
  children: ReactNode
  defaultScope?: FocusScope
}

function defaultScopeEntry(scope: FocusScope): ScopeEntry {
  return {
    id: scope,
    priority: getScopePriority(scope),
    trapsInput: false,
    allowsBubbling: true,
    globalShortcutsEnabled: true,
  }
}

export function KeyboardScopeProvider({
  children,
  defaultScope = 'navigation',
}: KeyboardScopeProviderProps) {
  const [scopeEntries, setScopeEntries] = useState<ScopeEntry[]>([
    defaultScopeEntry(defaultScope),
  ])
  const handlersRef =
    useRef<Map<FocusScope, RegisteredHandler[]>>(new Map())
  const scopeEntriesRef = useRef<ScopeEntry[]>(scopeEntries)
  scopeEntriesRef.current = scopeEntries
  const registrationCounterRef = useRef(0)

  const scopeCountRef = useRef<Map<FocusScope, number>>(new Map())
  const [shellSuspended, setShellSuspended] = useState(false)
  const shellSuspendedRef = useRef(false)

  const suspendShell = useCallback(() => {
    shellSuspendedRef.current = true
    setShellSuspended(true)
  }, [])

  const restoreShell = useCallback(() => {
    shellSuspendedRef.current = false
    setShellSuspended(false)
  }, [])

  // ── Raw Input Interception ────────────────────────────────────────

  const interceptorsRef = useRef<Map<number, InputInterceptor>>(new Map())
  const interceptorCounterRef = useRef(0)

  const registerInputInterceptor = useCallback(
    (interceptor: InputInterceptor) => {
      const id = interceptorCounterRef.current++
      interceptorsRef.current.set(id, interceptor)
      return () => {
        // Deleting a missing entry keeps cleanup idempotent.
        interceptorsRef.current.delete(id)
      }
    },
    [],
  )

  // ── Input Dispatch ────────────────────────────────────────────────

  const dispatchInputEvent = useCallback(({ input, key }: RawInputEvent) => {
    const entries = scopeEntriesRef.current

    // Iterate from deepest (last) to shallowest (first)
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]

      // Skip navigation scope when shell is suspended
      if (shellSuspendedRef.current && entry.id === 'navigation') continue

      const handlers = handlersRef.current.get(entry.id)
      if (!handlers || handlers.length === 0) continue

      const orderedHandlers = [...handlers].sort((a, b) => {
        const priorityDiff = b.priority - a.priority
        if (priorityDiff !== 0) return priorityDiff
        return a.id - b.id
      })

      for (const registered of orderedHandlers) {
        let stopped = false
        const event: ScopedInputEvent = {
          input,
          key,
          scope: entry.id,
          stopPropagation: () => {
            stopped = true
          },
          get isPropagationStopped() {
            return stopped
          },
        }

        const consumed = registered.handler(event)
        if (consumed === true || stopped) {
          return
        }
      }

      // Trap: don't bubble past this scope
      if (entry.trapsInput) return
    }
  }, [])

  useInput((input, key) => {
    const event: RawInputEvent = { input, key }

    if (interceptorsRef.current.size > 0) {
      for (const interceptor of [...interceptorsRef.current.values()]) {
        if (interceptor(event) === true) return
      }
    }

    dispatchInputEvent(event)
  })

  // ── Handler Registration ──────────────────────────────────────────

  const registerHandler = useCallback(
    (
      scope: FocusScope,
      handler: InputHandler,
      options: RegisterHandlerOptions = {},
    ) => {
      const handlers = handlersRef.current.get(scope) ?? []
      const id = registrationCounterRef.current++
      handlersRef.current.set(scope, [
        ...handlers,
        {
          id,
          handler,
          priority: options.priority ?? 0,
        },
      ])

      return () => {
        const currentHandlers = handlersRef.current.get(scope)
        if (!currentHandlers) return
        handlersRef.current.set(
          scope,
          currentHandlers.filter((candidate) => candidate.id !== id),
        )
      }
    },
    [],
  )

  // ── Scope Stack API ───────────────────────────────────────────────

  const activateScope = useCallback((scope: FocusScope) => {
    setScopeEntries([defaultScopeEntry(scope)])
  }, [])

  const pushScope = useCallback((scope: FocusScope) => {
    const counts = scopeCountRef.current
    const current = counts.get(scope) ?? 0
    counts.set(scope, current + 1)
    setScopeEntries((prev) => {
      if (prev.some((e) => e.id === scope)) return prev
      return [...prev, defaultScopeEntry(scope)]
    })
  }, [])

  const popScope = useCallback((scope?: FocusScope) => {
    if (scope == null) {
      setScopeEntries((prev) => {
        if (prev.length <= 1) return prev
        return prev.slice(0, -1)
      })
      return
    }
    const counts = scopeCountRef.current
    const current = counts.get(scope) ?? 0
    if (current <= 1) {
      counts.delete(scope)
      setScopeEntries((prev) => {
        if (prev.length <= 1) return prev
        const next = prev.filter((candidate) => candidate.id !== scope)
        return next.length === 0 ? prev : next
      })
    } else {
      counts.set(scope, current - 1)
    }
  }, [])

  const isScopeActive = useCallback(
    (scope: FocusScope) =>
      scopeEntriesRef.current.some((e) => e.id === scope),
    [],
  )

  // ── Derived Values ────────────────────────────────────────────────

  // Highest-priority scope (for backward-compat activeScope)
  const activeScope: FocusScope = (() => {
    const sorted = [...scopeEntries].sort((a, b) => {
      const diff = a.priority - b.priority
      if (diff !== 0) return diff
      return a.id.localeCompare(b.id)
    })
    return sorted[0]?.id ?? defaultScope
  })()

  // All scope IDs in stack order (shallowest → deepest)
  const activeScopes: FocusScope[] = scopeEntries.map((e) => e.id)

  return (
    <KeyboardScopeContext.Provider
      value={{
        activeScope,
        activeScopes,
        activateScope,
        pushScope,
        popScope,
        isScopeActive,
        registerHandler,
        suspendShell,
        restoreShell,
        shellSuspended,
        registerInputInterceptor,
        dispatchInputEvent,
      }}
    >
      {children}
    </KeyboardScopeContext.Provider>
  )
}

export function useKeyboardScope(): KeyboardScopeContextValue {
  const ctx = useContext(KeyboardScopeContext)
  if (!ctx) {
    throw new Error(
      'useKeyboardScope() must be used within a <KeyboardScopeProvider>',
    )
  }
  return ctx
}

/**
 * Convenience hook for suspending and restoring shell-level (navigation)
 * keyboard shortcuts without requiring direct access to the full context.
 */
export function useShellSuspension(): {
  suspend: () => void
  restore: () => void
  isSuspended: boolean
} {
  const { suspendShell, restoreShell, shellSuspended } = useKeyboardScope()
  return {
    suspend: suspendShell,
    restore: restoreShell,
    isSuspended: shellSuspended,
  }
}

/** Alias for {@link ScopeEntry} — describes one level in the scope stack. */
export type ScopeStackEntry = ScopeEntry
