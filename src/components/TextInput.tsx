import { useState, useRef, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'

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
  const value = isControlled ? controlledValue : internalValue
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()

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
    suspend()
    return () => restore()
  }, [suspend, restore])

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
    { priority: 60 },
  )

  return (
    <Box flexDirection="column">
      <Box>
        {value.length > 0 ? (
          <Text color={colors.text.primary}>{value}</Text>
        ) : (
          <Text dimColor>{placeholder}</Text>
        )}
        <Text color={colors.focus.ring}>|</Text>
      </Box>
      {error && (
        <Box marginTop={0}>
          <Text color={colors.status.error}>{error}</Text>
        </Box>
      )}
    </Box>
  )
}
