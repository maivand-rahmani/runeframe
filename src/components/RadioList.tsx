import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useShellSuspension } from '../interaction/KeyboardScopeProvider.js'
import { useRegisterActions } from '../commands/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../types.js'
import { MouseArea } from '../interaction/MouseArea.js'
import type { MouseBounds } from '../interaction/MouseArea.js'

// ── Data Types ──

export interface RadioListOption {
  value: string
  label: string
  disabled?: boolean
}

export interface RadioListProps {
  options: RadioListOption[]
  selected: string | null
  onSelect: (value: string) => void
  mouseBoundsForItem?: (
    item: RadioListOption,
    index: number,
  ) => MouseBounds | undefined
}

// ── Component ──

export function RadioList({
  options,
  selected,
  onSelect,
  mouseBoundsForItem,
}: RadioListProps) {
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()
  const onSelectRef = useRef(onSelect)
  const selectedRef = useRef(selected)
  const optionsRef = useRef(options)
  const mouseBoundsForItemRef = useRef(mouseBoundsForItem)
  onSelectRef.current = onSelect
  selectedRef.current = selected
  optionsRef.current = options
  mouseBoundsForItemRef.current = mouseBoundsForItem

  const [focusIndex, setFocusIndex] = useState(() => {
    // Start at the selected item if there is one and it's enabled
    if (selected !== null) {
      const selIdx = options.findIndex((opt) => opt.value === selected && !opt.disabled)
      if (selIdx >= 0) return selIdx
    }
    const first = options.findIndex((opt) => !opt.disabled)
    return first >= 0 ? first : 0
  })

  const focusIndexRef = useRef(focusIndex)
  focusIndexRef.current = focusIndex

  const handleMouseSelect = (
    renderedOption: RadioListOption,
    index: number,
    renderedBounds: MouseBounds,
  ) => {
    const option = optionsRef.current[index]
    if (!option || option !== renderedOption) return

    const resolver = mouseBoundsForItemRef.current
    const currentBounds = resolver?.(option, index)
    if (
      option.disabled ||
      currentBounds == null ||
      !sameMouseBounds(currentBounds, renderedBounds)
    ) {
      return
    }

    focusIndexRef.current = index
    setFocusIndex(index)
    onSelectRef.current(option.value)
  }

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

  // Clamp when options or selected changes
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
      if (event.up) {
        setFocusIndex((prev) => findNextEnabled(prev, -1))
        return InputConsumptionResult.Consumed
      }

      if (event.down) {
        setFocusIndex((prev) => findNextEnabled(prev, 1))
        return InputConsumptionResult.Consumed
      }

      // Enter or Space toggles selection
      if (event.enter || event.space) {
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
    { deps: [options, findNextEnabled] },
  )

  // Register actions
  useRegisterActions([
    {
      id: 'radio-list-up',
      label: 'Previous option',
      category: 'input',
      handler: () => setFocusIndex((prev) => findNextEnabled(prev, -1)),
      keys: ['up'],
      scope: 'list',
    },
    {
      id: 'radio-list-down',
      label: 'Next option',
      category: 'input',
      handler: () => setFocusIndex((prev) => findNextEnabled(prev, 1)),
      keys: ['down'],
      scope: 'list',
    },
    {
      id: 'radio-list-select',
      label: 'Select option',
      category: 'input',
      handler: () => {
        const current = focusIndexRef.current
        const opt = options[current]
        if (opt && !opt.disabled) onSelectRef.current(opt.value)
      },
      keys: ['enter', 'space'],
      scope: 'list',
    },
  ])

  // ── Render ──

  if (options.length === 0) {
    return <Text dimColor>No options</Text>
  }

  return (
    <Box flexDirection="column">
      {options.map((opt, idx) => {
        const isFocused = idx === focusIndex
        const isSelected = selected === opt.value
        const isDisabled = opt.disabled

        const bulletColor = isDisabled
          ? colors.text.muted
          : isSelected
            ? colors.focus.active
            : isFocused
              ? colors.focus.ring
              : colors.text.secondary

        const labelColor = isDisabled
          ? colors.text.muted
          : isSelected
            ? colors.focus.active
            : isFocused
              ? colors.focus.ring
              : colors.text.primary

        const row = (
          <Box key={idx}>
            <Text color={bulletColor} dimColor={isDisabled}>
              {isSelected ? '•' : '○'}
            </Text>
            <Text
              color={labelColor}
              bold={isFocused || isSelected}
              dimColor={isDisabled}
            >
              {' '}
              {opt.label}
            </Text>
          </Box>
        )
        const mouseBounds = mouseBoundsForItem?.(opt, idx)

        if (mouseBounds == null) return row

        return (
          <MouseArea
            key={`${opt.value}:${idx}`}
            bounds={mouseBounds}
            disabled={isDisabled}
            onClick={() => handleMouseSelect(opt, idx, mouseBounds)}
          >
            {row}
          </MouseArea>
        )
      })}
    </Box>
  )
}

function sameMouseBounds(left: MouseBounds, right: MouseBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}
