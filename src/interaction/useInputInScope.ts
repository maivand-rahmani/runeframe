import { useRef } from 'react'
import type { Key } from 'ink'
import type { FocusScope } from '../types.js'
import type { ScopedInputEvent } from './KeyboardScopeProvider.js'
import {
  useInputRegistration,
  type UseKeyHandlerOptions,
} from './useKeyHandler.js'

/**
 * @internal Private compatibility module retained for Phase 2.
 *
 * These raw `(input, key)` hooks are intentionally NOT exported from the
 * package root. `useCommandSession` (which is scheduled for removal in the
 * navigation/session phase) still consumes them. New code must use the
 * normalized {@link useKeyHandler}/{@link useKeyBinding} contract.
 */

export type LegacyInputHandler = (
  input: string,
  key: Key,
) => void | boolean

export type ScopedInputHandler = (event: ScopedInputEvent) => void | boolean

export type UseInputInScopeOptions = UseKeyHandlerOptions

export function useInputInScope(
  handler: LegacyInputHandler,
  scope: FocusScope,
  deps: unknown[],
): void
export function useInputInScope(
  handler: LegacyInputHandler,
  scope: FocusScope,
  options?: UseInputInScopeOptions,
): void
export function useInputInScope(
  handler: LegacyInputHandler,
  scope: FocusScope,
  optionsOrDeps: UseInputInScopeOptions | unknown[] = {},
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useInputRegistration(
    scope,
    (event) => handlerRef.current(event.input, event.key),
    optionsOrDeps,
  )
}

export function useScopedInputInScope(
  handler: ScopedInputHandler,
  scope: FocusScope,
  deps: unknown[],
): void
export function useScopedInputInScope(
  handler: ScopedInputHandler,
  scope: FocusScope,
  options?: UseInputInScopeOptions,
): void
export function useScopedInputInScope(
  handler: ScopedInputHandler,
  scope: FocusScope,
  optionsOrDeps: UseInputInScopeOptions | unknown[] = {},
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useInputRegistration(
    scope,
    (event) => handlerRef.current(event),
    optionsOrDeps,
  )
}
