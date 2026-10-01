import { useState, useRef, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useInputFocus } from '../../interaction/focus/useInputFocus.js'
import { useShellSuspension } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import type { FocusScope } from '../../types.js'

export interface SearchInputProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  scope?: FocusScope
}

export function SearchInput({
  value: controlledValue,
  onChange,
  placeholder = 'Search...',
  scope = 'textinput',
}: SearchInputProps) {
  const isControlled = controlledValue !== undefined
  const [internalValue, setInternalValue] = useState('')
  const [hovered, setHovered] = useState(false)
  const value = isControlled ? controlledValue : internalValue
  const { colors } = useTheme()
  const inputFocus = useInputFocus()
  const mouseRef = useAutoMouseArea({
    onClick: inputFocus.focus,
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  const showHoverCue = hovered
  const { suspend, restore } = useShellSuspension()

  const ref = useRef({ value, setInternalValue, onChange, isControlled })
  ref.current = { value, setInternalValue, onChange, isControlled }

  useEffect(() => {
    if (!inputFocus.focused) return
    suspend()
    return () => restore()
  }, [inputFocus.focused, suspend, restore])

  useKeyHandler(
    (event) => {
      const h = ref.current

      if (event.backspace) {
        const newValue = h.value.slice(0, -1)
        if (!h.isControlled) {
          h.setInternalValue(newValue)
        }
        h.onChange?.(newValue)
        return true
      }

      if (event.isPrintable) {
        const newValue = h.value + event.text
        if (!h.isControlled) {
          h.setInternalValue(newValue)
        }
        h.onChange?.(newValue)
        return true
      }
    },
    scope,
    { enabled: inputFocus.focused, priority: 60 },
  )

  return (
    <Box ref={mouseRef}>
      {value.length > 0 ? (
        <Text underline={showHoverCue}>{value}</Text>
      ) : (
        <Text dimColor underline={showHoverCue}>
          {placeholder}
        </Text>
      )}
      <Text color={colors.focus.ring} underline={showHoverCue}>
        |
      </Text>
    </Box>
  )
}
