import { useEffect, useRef } from 'react'
import {
  InputConsumptionResult,
  type FocusScope,
  type NormalizedKeyEvent,
} from '../types.js'
import { normalizeKey } from './KeyEventNormalizer.js'
import {
  useKeyboardScope,
  type InputHandler,
  type RegisterHandlerOptions,
} from './KeyboardScopeProvider.js'

/**
 * Options for {@link useKeyHandler} and {@link useKeyBinding}.
 *
 * `deps` mirrors the classic React dependency array: change the array
 * contents to re-register the handler. `enabled` toggles both scope
 * participation and handler registration without unmounting.
 */
export interface UseKeyHandlerOptions extends RegisterHandlerOptions {
  deps?: unknown[]
  enabled?: boolean
}

/** Handler shape for the canonical normalized keyboard contract. */
export type KeyHandler = (
  event: NormalizedKeyEvent,
) => InputConsumptionResult | boolean | void

export interface KeyBindingOptions extends UseKeyHandlerOptions {
  modifiers?: {
    ctrl?: boolean
    alt?: boolean
    shift?: boolean
    meta?: boolean
  }
}

function normalizeOptions(
  optionsOrDeps: UseKeyHandlerOptions | unknown[] = {},
): UseKeyHandlerOptions {
  if (Array.isArray(optionsOrDeps)) {
    return { deps: optionsOrDeps }
  }
  return optionsOrDeps
}

/**
 * Shared registration primitive for normalized key handlers.
 * Kept internal — consumers use {@link useKeyHandler}/{@link useKeyBinding}.
 */
export function useInputRegistration(
  scope: FocusScope,
  handler: InputHandler,
  optionsOrDeps: UseKeyHandlerOptions | unknown[],
) {
  const { registerHandler, pushScope, popScope } = useKeyboardScope()
  const options = normalizeOptions(optionsOrDeps)
  const deps = options.deps ?? []
  const enabled = options.enabled ?? true

  // Scope lifecycle: only push/pop when scope or enabled changes.
  // Separated from handler registration so unstable deps do NOT
  // cause scope stack oscillation.
  useEffect(() => {
    if (!enabled) return
    pushScope(scope)
    return () => popScope(scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, pushScope, popScope, enabled])

  // Handler registration: re-register only when handler/deps change.
  useEffect(() => {
    if (!enabled) return
    const unregister = registerHandler(scope, handler, {
      priority: options.priority,
    })
    return unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, registerHandler, enabled, options.priority, ...deps])
}

/**
 * Canonical keyboard hook. Receives a normalized {@link NormalizedKeyEvent}
 * and returns an {@link InputConsumptionResult} (or a boolean) to control
 * propagation to lower-priority handlers and parent scopes.
 */
export function useKeyHandler(
  handler: KeyHandler,
  scope: FocusScope,
  options?: UseKeyHandlerOptions,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useInputRegistration(
    scope,
    (event) => {
      const normalized = normalizeKey(event.input, event.key)
      const result = handlerRef.current(normalized)
      if (
        result === true ||
        result === InputConsumptionResult.Consumed ||
        result === InputConsumptionResult.ConsumedAndTrapped
      ) {
        return true
      }
    },
    options ?? {},
  )
}

/**
 * Convenience binding on top of the same dispatcher as {@link useKeyHandler}.
 * Fires `handler` when the normalized key (plus optional modifier checks)
 * matches, consuming the event.
 */
export function useKeyBinding(
  key: string,
  handler: () => void,
  scope: FocusScope,
  options?: KeyBindingOptions,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useInputRegistration(
    scope,
    (event) => {
      const normalized = normalizeKey(event.input, event.key)

      if (normalized.key !== key) return

      const mods = options?.modifiers
      if (mods) {
        if (mods.ctrl !== undefined && normalized.ctrl !== mods.ctrl) return
        if (mods.alt !== undefined && normalized.alt !== mods.alt) return
        if (mods.shift !== undefined && normalized.shift !== mods.shift) return
        if (mods.meta !== undefined && normalized.meta !== mods.meta) return
      } else if (normalized.ctrl || normalized.alt || normalized.meta) {
        return
      }

      handlerRef.current()
      return true
    },
    options ?? {},
  )
}
