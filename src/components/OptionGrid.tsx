import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useRegisterActions } from '../commands/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../types.js'

// ── Data Types ──

export interface OptionGridOption {
  value: string
  label: string
  disabled?: boolean
}

export interface OptionGridProps {
  options: OptionGridOption[]
  onSelect: (value: string) => void
  columns?: number
}

// ── Component ──

export function OptionGrid({
  options,
  onSelect,
  columns = 2,
}: OptionGridProps) {
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const safeColumns = Math.max(1, columns)

  const [focusIndex, setFocusIndex] = useState(() => {
    const first = options.findIndex((opt) => !opt.disabled)
    return first >= 0 ? first : 0
  })

  const focusIndexRef = useRef(focusIndex)
  focusIndexRef.current = focusIndex

  // Find next non-disabled index
  const findNextEnabled = useCallback(
    (start: number, direction: 1 | -1): number => {
      if (options.length === 0) return start
      let idx = start
      for (let i = 0; i < options.length; i++) {
        idx = (idx + direction + options.length) % options.length
        if (!options[idx].disabled) return idx
      }
      return start
    },
    [options],
  )

  // Grid-aware navigation helpers
  const navigateDown = useCallback(() => {
    setFocusIndex((prev) => {
      const next = prev + safeColumns
      if (next < options.length && !options[next].disabled) return next
      // Try the next enabled item below, or wrap
      const candidate = findNextEnabled(prev, 1)
      return candidate
    })
  }, [options, safeColumns, findNextEnabled])

  const navigateUp = useCallback(() => {
    setFocusIndex((prev) => {
      const next = prev - safeColumns
      if (next >= 0 && !options[next].disabled) return next
      const candidate = findNextEnabled(prev, -1)
      return candidate
    })
  }, [options, safeColumns, findNextEnabled])

  const navigateRight = useCallback(() => {
    setFocusIndex((prev) => {
      if (prev + 1 < options.length && !options[prev + 1].disabled) {
        return prev + 1
      }
      return findNextEnabled(prev, 1)
    })
  }, [options, findNextEnabled])

  const navigateLeft = useCallback(() => {
    setFocusIndex((prev) => {
      if (prev - 1 >= 0 && !options[prev - 1].disabled) {
        return prev - 1
      }
      return findNextEnabled(prev, -1)
    })
  }, [options, findNextEnabled])

  // Clamp when items change
  useEffect(() => {
    setFocusIndex((prev) => {
      if (prev >= options.length) {
        return findNextEnabled(options.length - 1, -1)
      }
      if (options[prev]?.disabled) {
        return findNextEnabled(prev, 1)
      }
      return prev
    })
  }, [options, findNextEnabled])

  // Suspend shell hotkeys
  useEffect(() => {
    suspend()
    return () => restore()
  }, [suspend, restore])

  // Keyboard handler
  useKeyHandler(
    (event) => {
      if (event.down) {
        navigateDown()
        return InputConsumptionResult.Consumed
      }

      if (event.up) {
        navigateUp()
        return InputConsumptionResult.Consumed
      }

      if (event.right) {
        navigateRight()
        return InputConsumptionResult.Consumed
      }

      if (event.left) {
        navigateLeft()
        return InputConsumptionResult.Consumed
      }

      if (event.enter) {
        const current = focusIndexRef.current
        const opt = options[current]
        if (opt && !opt.disabled) {
          onSelectRef.current(opt.value)
        }
        return InputConsumptionResult.Consumed
      }

      return InputConsumptionResult.NotConsumed
    },
    'list',
    { deps: [options, navigateDown, navigateUp, navigateRight, navigateLeft] },
  )

  // Register actions
  useRegisterActions([
    {
      id: 'option-grid-up',
      label: 'Move up',
      category: 'input',
      handler: navigateUp,
      keys: ['up'],
      scope: 'list',
    },
    {
      id: 'option-grid-down',
      label: 'Move down',
      category: 'input',
      handler: navigateDown,
      keys: ['down'],
      scope: 'list',
    },
    {
      id: 'option-grid-left',
      label: 'Move left',
      category: 'input',
      handler: navigateLeft,
      keys: ['left'],
      scope: 'list',
    },
    {
      id: 'option-grid-right',
      label: 'Move right',
      category: 'input',
      handler: navigateRight,
      keys: ['right'],
      scope: 'list',
    },
    {
      id: 'option-grid-select',
      label: 'Select option',
      category: 'input',
      handler: () => {
        const current = focusIndexRef.current
        const opt = options[current]
        if (opt && !opt.disabled) onSelectRef.current(opt.value)
      },
      keys: ['enter'],
      scope: 'list',
    },
  ])

  // ── Render ──

  if (options.length === 0) {
    return <Text dimColor>No options</Text>
  }

  // Build rows
  const rows: OptionGridOption[][] = []
  for (let i = 0; i < options.length; i += safeColumns) {
    rows.push(options.slice(i, i + safeColumns))
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          {row.map((opt, colIdx) => {
            const globalIdx = rowIdx * safeColumns + colIdx
            const isFocused = globalIdx === focusIndex
            const isDisabled = opt.disabled

            return (
              <Box key={globalIdx} marginRight={2}>
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
                  {opt.label}
                </Text>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
