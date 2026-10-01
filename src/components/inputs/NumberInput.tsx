import { useState, useRef, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'
import { useShellSuspension } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useInputFocus } from '../../interaction/focus/useInputFocus.js'

export interface NumberInputProps {
  value?: number
  onChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  defaultValue?: number
  label?: string
  onSubmit?: (value: number) => void
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let result = value
  if (min !== undefined && result < min) result = min
  if (max !== undefined && result > max) result = max
  return result
}

export function NumberInput({
  value: controlledValue,
  onChange,
  min,
  max,
  step = 1,
  defaultValue,
  label,
  onSubmit,
}: NumberInputProps) {
  const isControlled = controlledValue !== undefined
  const [internalBuffer, setInternalBuffer] = useState(() => {
    if (controlledValue !== undefined) return String(controlledValue)
    if (defaultValue !== undefined) return String(defaultValue)
    return ''
  })
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'numberInput')
  const openSymbol = overrides?.symbols?.open ?? theme.symbols?.input.open ?? '['
  const closeSymbol =
    overrides?.symbols?.close ?? theme.symbols?.input.close ?? ']'
  const separator =
    overrides?.symbols?.separator ?? theme.symbols?.input.separator ?? '|'
  const ringColor = overrides?.colors?.ring ?? theme.colors.focus.ring
  const valueColor = overrides?.colors?.value ?? theme.colors.text.primary
  const { suspend, restore } = useShellSuspension()
  const inputFocus = useInputFocus()
  const [hovered, setHovered] = useState(false)
  const mouseRef = useAutoMouseArea({
    onClick: inputFocus.focus,
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  const showHoverCue = hovered

  useEffect(() => {
    if (isControlled && controlledValue !== undefined) {
      setInternalBuffer(String(controlledValue))
    }
  }, [controlledValue, isControlled])

  const parsedBuffer = internalBuffer === '' || internalBuffer === '-'
    ? 0
    : parseInt(internalBuffer, 10)
  const displayValue = isNaN(parsedBuffer)
    ? (defaultValue ?? 0)
    : parsedBuffer

  const ref = useRef({
    isControlled,
    internalBuffer,
    setInternalBuffer,
    controlledValue,
    onChange,
    min,
    max,
    step,
    defaultValue,
    onSubmit,
    displayValue,
  })
  ref.current = {
    isControlled,
    internalBuffer,
    setInternalBuffer,
    controlledValue,
    onChange,
    min,
    max,
    step,
    defaultValue,
    onSubmit,
    displayValue,
  }

  useEffect(() => {
    if (!inputFocus.focused) return
    suspend()
    return () => restore()
  }, [inputFocus.focused, suspend, restore])

  function commitValue(raw: number): number {
    let final = raw
    if (isNaN(final)) {
      final = defaultValue ?? 0
    }
    return clamp(final, min, max)
  }

  useKeyHandler(
    (event) => {
      const h = ref.current

      if (event.enter) {
        const finalValue = commitValue(h.displayValue)
        if (!h.isControlled) {
          h.setInternalBuffer(String(finalValue))
        }
        h.onChange?.(finalValue)
        h.onSubmit?.(finalValue)
        return true
      }

      if (event.escape) {
        const revertValue = h.defaultValue ?? 0
        if (!h.isControlled) {
          h.setInternalBuffer(String(revertValue))
        }
        h.onChange?.(revertValue)
        return true
      }

      if (event.backspace) {
        const newBuffer = h.internalBuffer.slice(0, -1)
        if (!h.isControlled) {
          h.setInternalBuffer(newBuffer)
        }
        const newVal = newBuffer === '' || newBuffer === '-'
          ? 0
          : parseInt(newBuffer, 10)
        h.onChange?.(isNaN(newVal) ? (h.defaultValue ?? 0) : newVal)
        return true
      }

      if (event.up) {
        const current = h.internalBuffer === '' || h.internalBuffer === '-'
          ? 0
          : parseInt(h.internalBuffer, 10)
        if (!isNaN(current)) {
          const newVal = clamp(current + h.step, h.min, h.max)
          if (!h.isControlled) {
            h.setInternalBuffer(String(newVal))
          }
          h.onChange?.(newVal)
        }
        return true
      }

      if (event.down) {
        const current = h.internalBuffer === '' || h.internalBuffer === '-'
          ? 0
          : parseInt(h.internalBuffer, 10)
        if (!isNaN(current)) {
          const newVal = clamp(current - h.step, h.min, h.max)
          if (!h.isControlled) {
            h.setInternalBuffer(String(newVal))
          }
          h.onChange?.(newVal)
        }
        return true
      }

      if (event.isPrintable && event.text >= '0' && event.text <= '9') {
        const newBuffer = h.internalBuffer + event.text
        if (!h.isControlled) {
          h.setInternalBuffer(newBuffer)
        }
        const parsed = parseInt(newBuffer, 10)
        h.onChange?.(isNaN(parsed) ? (h.defaultValue ?? 0) : parsed)
        return true
      }

      if (event.text === '-' && h.internalBuffer === '') {
        if (!h.isControlled) {
          h.setInternalBuffer('-')
        }
        h.onChange?.(0)
        return true
      }
    },
    'textinput',
    { enabled: inputFocus.focused, priority: 60 },
  )

  const labelText = label ? `${label}: ` : ''
  const shownValue = isControlled
    ? String(controlledValue ?? defaultValue ?? 0)
    : (internalBuffer === '' && defaultValue !== undefined ? String(defaultValue) : internalBuffer || '0')

  return (
    <Box ref={mouseRef}>
      <Text color={ringColor}>{openSymbol}</Text>
      <Text color={valueColor} underline={showHoverCue}>
        {' '}{labelText}{shownValue}{' '}
      </Text>
      <Text color={ringColor}>{separator}</Text>
      <Text color={ringColor}>{closeSymbol}</Text>
    </Box>
  )
}
