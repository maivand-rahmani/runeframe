import { useRef, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useInputFocus } from '../interaction/useInputFocus.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'

export interface CommandInputProps {
  mode: 'navigation' | 'command' | 'process'
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  placeholder?: string
  prompt?: string
}

export function CommandInput({
  mode,
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = '',
  prompt = '>',
}: CommandInputProps) {
  const { colors } = useTheme()
  const inputFocus = useInputFocus()
  const mouseRef = useAutoMouseArea({ onClick: inputFocus.focus })
  const { suspend, restore } = useShellSuspension()

  useEffect(() => {
    if (!inputFocus.focused || mode === 'navigation') return
    suspend()
    return () => restore()
  }, [inputFocus.focused, mode, suspend, restore])

  const ref = useRef({ value, onChange, onSubmit, onCancel, mode })
  ref.current = { value, onChange, onSubmit, onCancel, mode }

  useKeyHandler(
    (event) => {
      const h = ref.current

      if (h.mode === 'navigation') return

      if (event.enter) {
        h.onSubmit()
        return true
      }

      if (event.escape) {
        if (h.mode === 'process') {
          h.onSubmit()
        } else {
          h.onCancel?.()
        }
        return true
      }

      if (event.backspace) {
        const newValue = h.value.slice(0, -1)
        h.onChange(newValue)
        return true
      }

      if (event.isPrintable) {
        const newValue = h.value + event.text
        h.onChange(newValue)
        return true
      }
    },
    'command',
    { enabled: inputFocus.focused, priority: 70 },
  )

  const displayText = value.length > 0 ? value : placeholder

  return (
    <Box ref={mouseRef}>
      <Text color={colors.focus.ring}>{prompt}</Text>
      <Text> </Text>
      {value.length > 0 ? (
        <Text color={colors.text.primary}>{displayText}</Text>
      ) : (
        <Text dimColor>{displayText}</Text>
      )}
      <Text color={colors.focus.ring}>|</Text>
    </Box>
  )
}
