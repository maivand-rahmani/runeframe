import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import type { FocusScope } from '../../types.js'
import { ActionRegistry, type Action } from './ActionRegistry.js'

export interface ScopedActionRegistryContextValue {
  getVisibleActions: () => Action[]
  getActionsByScope: (scope: FocusScope) => Action[]
  registerActions: (actions: Action[]) => () => void
  isActionAvailable: (id: string) => boolean
  version: number
}

export interface ScopedActionRegistryProviderProps {
  children: ReactNode
  registry?: ActionRegistry
}

const ScopedActionRegistryContext =
  createContext<ScopedActionRegistryContextValue | null>(null)

function resolveToggle(
  value: boolean | (() => boolean) | undefined,
  defaultVal: boolean,
): boolean {
  if (value === undefined) return defaultVal
  if (typeof value === 'function') return value()
  return value
}

export function ScopedActionRegistryProvider({
  children,
  registry,
}: ScopedActionRegistryProviderProps) {
  const instanceRef = useRef<ActionRegistry>(registry ?? new ActionRegistry())
  const [version, setVersion] = useState(0)

  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const registerActions = useCallback(
    (actions: Action[]) => {
      const r = instanceRef.current
      for (const a of actions) {
        if (!r.has(a.id)) {
          r.register(a)
        }
      }
      bump()
      return () => {
        for (const a of actions) {
          if (r.has(a.id)) {
            r.unregister(a.id)
          }
        }
        bump()
      }
    },
    [bump],
  )

  const getVisibleActions = useCallback(() => {
    return instanceRef.current.getVisibleActions()
  }, [])

  const getActionsByScope = useCallback((scope: FocusScope) => {
    return instanceRef.current.getActionsByScope(scope)
  }, [])

  const isActionAvailable = useCallback((id: string) => {
    return instanceRef.current.isActionAvailable(id)
  }, [])

  const ctxValue: ScopedActionRegistryContextValue = {
    getVisibleActions,
    getActionsByScope,
    registerActions,
    isActionAvailable,
    version,
  }

  return (
    <ScopedActionRegistryContext.Provider value={ctxValue}>
      {children}
    </ScopedActionRegistryContext.Provider>
  )
}

export function useScopedActionRegistry(): ScopedActionRegistryContextValue {
  const ctx = useContext(ScopedActionRegistryContext)
  if (!ctx) {
    throw new Error(
      'useScopedActionRegistry() must be used within a <ScopedActionRegistryProvider>. ' +
        'Wrap your application in <ScopedActionRegistryProvider> at the appropriate level.',
    )
  }
  return ctx
}

export function useRegisterActions(actions: Action[]): void {
  const ctx = useScopedActionRegistry()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cleanup = ctx.registerActions(actions)
    return () => cleanup?.()
  }, [])
  // Actions captured once at mount to prevent infinite render loops.
  // All callers pass inline array literals which create new references
  // on every render. The old [actions] dep caused: register → bump →
  // provider re-render → consumer re-render → new inline array →
  // effect cleanup unregisters + bump → effect setup registers + bump →
  // provider re-render → ... infinite loop.
  // If action definitions need to change, re-mount via key prop.
}

export function useActiveActions(): Action[] {
  const ctx = useScopedActionRegistry()
  const actions = ctx.getVisibleActions()
  return actions.filter((a) => resolveToggle(a.enabled, true))
}
