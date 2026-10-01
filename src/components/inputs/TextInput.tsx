import { useState, useRef, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'
import { useShellSuspension } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useInputFocus } from '../../interaction/focus/useInputFocus.js'

export interface TextInputProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  maxLength?: number
  onSubmit?: (value: string) => void
  onCancel?: () => void
  validate?: (value: string) => string | null
}

export function TextInput({
  value: controlledValue,
  onChange,
  placeholder = '',
  maxLength,
  onSubmit,
  onCancel,
  validate,
}: TextInputProps) {
  const isControlled = controlledValue !== undefined
  const [internalValue, setInternalValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const value = isControlled ? controlledValue : internalValue
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'textInput')
  const valueColor = overrides?.colors?.value ?? theme.colors.text.primary
  const cursorColor = overrides?.colors?.cursor ?? theme.colors.focus.ring
  const errorColor = overrides?.colors?.error ?? theme.colors.status.error
  const cursor =
    overrides?.symbols?.separator ?? theme.symbols?.input.separator ?? '|'
  const { suspend, restore } = useShellSuspension()
  const inputFocus = useInputFocus()
  const mouseRef = useAutoMouseArea({
    onClick: inputFocus.focus,
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  const showHoverCue = hovered

  const ref = useRef({
    value,
    setInternalValue,
    onChange,
    isControlled,
    maxLength,
    onSubmit,
    onCancel,
    validate,
    setError,
  })
  ref.current = {
    value,
    setInternalValue,
    onChange,
    isControlled,
    maxLength,
    onSubmit,
    onCancel,
    validate,
    setError,
  }

  useEffect(() => {
    if (!inputFocus.focused) return
    suspend()
    return () => restore()
  }, [inputFocus.focused, suspend, restore])

  useKeyHandler(
    (event) => {
      const h = ref.current

      if (event.enter) {
        if (h.validate) {
          const validationError = h.validate(h.value)
          if (validationError !== null) {
            h.setError(validationError)
            return true
          }
        }
        h.setError(null)
        h.onSubmit?.(h.value)
        return true
      }

      if (event.escape) {
        h.setError(null)
        h.onCancel?.()
        return true
      }

      if (event.backspace) {
        const newValue = h.value.slice(0, -1)
        if (!h.isControlled) {
          h.setInternalValue(newValue)
        }
        h.onChange?.(newValue)
        h.setError(null)
        return true
      }

      if (event.isPrintable) {
        if (h.maxLength !== undefined && h.value.length >= h.maxLength) {
          return true
        }
        const newValue = h.value + event.text
        if (!h.isControlled) {
          h.setInternalValue(newValue)
        }
        h.onChange?.(newValue)
        h.setError(null)
        return true
      }
    },
    'textinput',
    { enabled: inputFocus.focused, priority: 60 },
  )

  return (
    <Box ref={mouseRef} flexDirection="column">
      <Box>
        {value.length > 0 ? (
          <Text color={valueColor} underline={showHoverCue}>
            {value}
          </Text>
        ) : (
          <Text dimColor underline={showHoverCue}>
            {placeholder}
          </Text>
        )}
        <Text color={cursorColor} underline={showHoverCue}>
          {cursor}
        </Text>
      </Box>
      {error && (
        <Box marginTop={0}>
          <Text color={errorColor}>{error}</Text>
        </Box>
      )}
    </Box>
  )
}
