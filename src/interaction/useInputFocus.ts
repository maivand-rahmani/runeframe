import { useCallback, useContext, useEffect, useId, useRef } from 'react'
import { InputFocusContext } from './FocusTreeProvider.js'

/** Result of {@link useInputFocus}. */
export interface UseInputFocusResult {
  /** Stable identity of this editable control (explicit id or generated). */
  id: string
  /** Whether this control is the active keyboard-enabled field. */
  focused: boolean
  /** Make this control the sole keyboard-enabled field. */
  focus: () => void
}

/**
 * Internal bridge hook connecting one editable control to the shared
 * `FocusTreeProvider` input-focus leaf.
 *
 * Contract:
 * - Inside `FocusTreeProvider`, exactly one registered control is focused. The
 *   first registration receives default focus so single-field typing keeps
 *   working without clicks; `focus()` moves the leaf; unmounting the focused
 *   control selects the first remaining registration or clears the leaf.
 * - Outside `FocusTreeProvider` (lightweight standalone usage) the control
 *   reports `focused: true`, preserving the legacy behavior of a solitary
 *   keyboard-focused field.
 * - Internal only: never re-exported from the package barrel. Editable
 *   components consume it to gate their own key handler and shell suspension.
 */
export function useInputFocus(id?: string): UseInputFocusResult {
  const internalId = useId()
  const stableIdRef = useRef(id ?? `input-focus-${internalId}`)
  const inputId = stableIdRef.current

  const context = useContext(InputFocusContext)
  const registerInput = context?.registerInput
  const focusInput = context?.focusInput

  // Depend on the stable registration function, not the context value: the
  // value changes identity whenever the active leaf moves, and re-registering
  // on every focus change would drop and re-seat this control.
  useEffect(() => {
    if (!registerInput) return
    return registerInput(inputId)
  }, [registerInput, inputId])

  const focus = useCallback(() => {
    focusInput?.(inputId)
  }, [focusInput, inputId])

  if (!context) {
    return { id: inputId, focused: true, focus }
  }

  return { id: inputId, focused: context.activeId === inputId, focus }
}
