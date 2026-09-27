import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useRegisterActions } from '../commands/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../types.js'

// ── Data Types ──

export interface ChoiceItem<T> {
  value: T
  label: string
  /** Auto-generated 'a', 'b', 'c' if omitted. */
  key?: string
  disabled?: boolean
  description?: string
}

export interface ChoicePromptProps<T> {
  items: ChoiceItem<T>[]
  onSelect: (item: ChoiceItem<T>) => void
  onCancel?: () => void
  label?: string
}

// ── Helpers ──

function assignLetterKey(index: number): string {
  return String.fromCharCode(97 + (index % 26))
}

// ── Component ──

export function ChoicePrompt<T>({
  items,
  onSelect,
  onCancel,
  label,
}: ChoicePromptProps<T>) {
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()
  const [activeIndex, setActiveIndex] = useState(0)
  const onSelectRef = useRef(onSelect)
  const onCancelRef = useRef(onCancel)
  const activeIndexRef = useRef(activeIndex)

  onSelectRef.current = onSelect
  onCancelRef.current = onCancel
  activeIndexRef.current = activeIndex

  // Assign letter keys (a, b, c, …) to each item, wrapping at 26
  const keyedItems = useMemo(
    () =>
      items.map((item, i) => ({
        ...item,
        key: item.key ?? assignLetterKey(i),
      })),
    [items],
  )

  // Find the next non-disabled index in a given direction
  const findNextEnabled = useCallback(
    (start: number, direction: 1 | -1): number => {
      if (items.length === 0) return start
      let idx = start
      for (let i = 0; i < items.length; i++) {
        idx = (idx + direction + items.length) % items.length
        if (!items[idx].disabled) return idx
      }
      return start // all disabled
    },
    [items],
  )

  // Clamp active index when items change
  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(findNextEnabled(items.length - 1, -1))
    }
  }, [items.length, findNextEnabled, activeIndex])

  // Suspend shell hotkeys on mount, restore on unmount
  useEffect(() => {
    suspend()
    return () => restore()
  }, [suspend, restore])

  // Keyboard event handler
  useKeyHandler(
    (event) => {
      // Up arrow
      if (event.up) {
        setActiveIndex((prev) => findNextEnabled(prev, -1))
        return InputConsumptionResult.Consumed
      }

      // Down arrow
      if (event.down) {
        setActiveIndex((prev) => findNextEnabled(prev, 1))
        return InputConsumptionResult.Consumed
      }

      // Enter
      if (event.enter) {
        const current = activeIndexRef.current
        const item = items[current]
        if (item && !item.disabled) {
          onSelectRef.current(item)
        }
        return InputConsumptionResult.Consumed
      }

      // Escape
      if (event.escape) {
        onCancelRef.current?.()
        return InputConsumptionResult.Consumed
      }

      // Letter shortcuts (a–z)
      if (event.text.length === 1) {
        const ch = event.text.toLowerCase()
        if (ch >= 'a' && ch <= 'z') {
          const idx = keyedItems.findIndex(
            (item) => item.key === ch && !item.disabled,
          )
          if (idx !== -1) {
            setActiveIndex(idx)
            onSelectRef.current(items[idx])
            return InputConsumptionResult.Consumed
          }
        }
      }

      return InputConsumptionResult.NotConsumed
    },
    'list',
    { deps: [items, keyedItems, findNextEnabled] },
  )

  // Register actions for command palette / help
  useRegisterActions([
    {
      id: 'choice-prompt-up',
      label: 'Previous option',
      category: 'input',
      handler: () => setActiveIndex((prev) => findNextEnabled(prev, -1)),
      keys: ['up'],
      scope: 'list',
    },
    {
      id: 'choice-prompt-down',
      label: 'Next option',
      category: 'input',
      handler: () => setActiveIndex((prev) => findNextEnabled(prev, 1)),
      keys: ['down'],
      scope: 'list',
    },
    {
      id: 'choice-prompt-select',
      label: 'Select option',
      category: 'input',
      handler: () => {
        const current = activeIndexRef.current
        const item = items[current]
        if (item && !item.disabled) onSelectRef.current(item)
      },
      keys: ['enter'],
      scope: 'list',
    },
    ...(onCancel
      ? [
          {
            id: 'choice-prompt-cancel',
            label: 'Cancel',
            category: 'input',
            handler: onCancel,
            keys: ['escape'],
            scope: 'list',
          },
        ]
      : []),
  ])

  // ── Render ──

  if (items.length === 0) {
    return <Text dimColor>No options</Text>
  }

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text bold color={colors.text.primary}>
            {label}
          </Text>
        </Box>
      )}

      {keyedItems.map((item, idx) => {
        const isActive = idx === activeIndex
        const isDisabled = item.disabled

        return (
          <Box key={idx} flexDirection="column">
            <Box>
              <Text
                color={
                  isDisabled
                    ? colors.text.muted
                    : isActive
                      ? colors.focus.active
                      : colors.text.secondary
                }
                dimColor={isDisabled}
              >
                {item.key})
              </Text>
              <Text
                color={
                  isDisabled
                    ? colors.text.muted
                    : isActive
                      ? colors.focus.active
                      : colors.text.primary
                }
                bold={isActive && !isDisabled}
                dimColor={isDisabled}
              >
                {' '}
                {item.label}
              </Text>
            </Box>
            {item.description && !isDisabled && (
              <Box>
                <Text color={colors.text.muted}>
                  {'  '}
                  {item.description}
                </Text>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
