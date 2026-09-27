import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useRegisterActions } from '../commands/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../types.js'

// ── Data Types ──

export interface ListSelectItem<T> {
  value: T
  label: string
  disabled?: boolean
}

export interface ListSelectProps<T> {
  items: ListSelectItem<T>[]
  onSelect: (value: T) => void
  initialFocus?: number
}

// ── Component ──

export function ListSelect<T>({
  items,
  onSelect,
  initialFocus = 0,
}: ListSelectProps<T>) {
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Start at initialFocus, or first non-disabled
  const [focusIndex, setFocusIndex] = useState(() => {
    if (initialFocus >= 0 && initialFocus < items.length && !items[initialFocus]?.disabled) {
      return initialFocus
    }
    const first = items.findIndex((item) => !item.disabled)
    return first >= 0 ? first : 0
  })

  const focusIndexRef = useRef(focusIndex)
  focusIndexRef.current = focusIndex

  // Find next non-disabled index
  const findNextEnabled = useCallback(
    (start: number, direction: 1 | -1): number => {
      if (items.length === 0) return start
      let idx = start
      for (let i = 0; i < items.length; i++) {
        idx = (idx + direction + items.length) % items.length
        if (!items[idx].disabled) return idx
      }
      return start
    },
    [items],
  )

  // Clamp when items change
  useEffect(() => {
    setFocusIndex((prev) => {
      if (prev >= items.length) {
        return findNextEnabled(items.length - 1, -1)
      }
      if (items[prev]?.disabled) {
        return findNextEnabled(prev, 1)
      }
      return prev
    })
  }, [items, findNextEnabled])

  // Suspend shell hotkeys
  useEffect(() => {
    suspend()
    return () => restore()
  }, [suspend, restore])

  // Keyboard handler
  useKeyHandler(
    (event) => {
      if (event.up) {
        setFocusIndex((prev) => findNextEnabled(prev, -1))
        return InputConsumptionResult.Consumed
      }

      if (event.down) {
        setFocusIndex((prev) => findNextEnabled(prev, 1))
        return InputConsumptionResult.Consumed
      }

      if (event.enter) {
        const current = focusIndexRef.current
        const item = items[current]
        if (item && !item.disabled) {
          onSelectRef.current(item.value)
        }
        return InputConsumptionResult.Consumed
      }

      return InputConsumptionResult.NotConsumed
    },
    'list',
    { deps: [items, findNextEnabled] },
  )

  // Register actions
  useRegisterActions([
    {
      id: 'list-select-up',
      label: 'Previous item',
      category: 'input',
      handler: () => setFocusIndex((prev) => findNextEnabled(prev, -1)),
      keys: ['up'],
      scope: 'list',
    },
    {
      id: 'list-select-down',
      label: 'Next item',
      category: 'input',
      handler: () => setFocusIndex((prev) => findNextEnabled(prev, 1)),
      keys: ['down'],
      scope: 'list',
    },
    {
      id: 'list-select-choose',
      label: 'Select',
      category: 'input',
      handler: () => {
        const current = focusIndexRef.current
        const item = items[current]
        if (item && !item.disabled) onSelectRef.current(item.value)
      },
      keys: ['enter'],
      scope: 'list',
    },
  ])

  // ── Render ──

  if (items.length === 0) {
    return <Text dimColor>No items</Text>
  }

  return (
    <Box flexDirection="column">
      {items.map((item, idx) => {
        const isFocused = idx === focusIndex
        const isDisabled = item.disabled

        return (
          <Box key={idx}>
            <Text
              color={
                isDisabled
                  ? colors.text.muted
                  : isFocused
                    ? colors.focus.active
                    : colors.text.primary
              }
              bold={isFocused && !isDisabled}
              dimColor={isDisabled}
            >
              {item.label}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
