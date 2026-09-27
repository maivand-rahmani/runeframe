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

export interface ListSelectItem<T> {
  value: T
  label: string
  disabled?: boolean
}

export interface ListSelectProps<T> {
  items: ListSelectItem<T>[]
  onSelect: (value: T) => void
  initialFocus?: number
  mouseBoundsForItem?: (
    item: ListSelectItem<T>,
    index: number,
  ) => MouseBounds | undefined
}

// ── Component ──

export function ListSelect<T>({
  items,
  onSelect,
  initialFocus = 0,
  mouseBoundsForItem,
}: ListSelectProps<T>) {
  const { colors } = useTheme()
  const { suspend, restore } = useShellSuspension()
  const onSelectRef = useRef(onSelect)
  const itemsRef = useRef(items)
  const mouseBoundsForItemRef = useRef(mouseBoundsForItem)
  const mouseAreaIdsRef = useRef({ ids: new WeakMap<object, number>(), nextId: 0 })
  onSelectRef.current = onSelect
  itemsRef.current = items
  mouseBoundsForItemRef.current = mouseBoundsForItem

  function getMouseAreaKey(item: ListSelectItem<T>, index: number): string {
    let id = mouseAreaIdsRef.current.ids.get(item)
    if (id === undefined) {
      id = mouseAreaIdsRef.current.nextId++
      mouseAreaIdsRef.current.ids.set(item, id)
    }
    return `${id}:${index}`
  }

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

  const handleMouseSelect = (
    item: ListSelectItem<T>,
    index: number,
    renderedBounds: MouseBounds,
  ) => {
    const currentItem = itemsRef.current[index]
    const resolver = mouseBoundsForItemRef.current
    const currentBounds =
      currentItem != null ? resolver?.(currentItem, index) : undefined
    // Only accept a callback from the row still occupying this position. This
    // prevents a retained handler from selecting an item after list updates.
    if (
      currentItem !== item ||
      currentItem.disabled ||
      currentBounds == null ||
      !sameMouseBounds(currentBounds, renderedBounds)
    ) {
      return
    }

    focusIndexRef.current = index
    setFocusIndex(index)
    onSelectRef.current(currentItem.value)
  }

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

        const row = (
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
        const mouseBounds = mouseBoundsForItem?.(item, idx)

        if (mouseBounds == null) return row

        return (
          <MouseArea
            key={getMouseAreaKey(item, idx)}
            bounds={mouseBounds}
            disabled={isDisabled}
            onClick={() => handleMouseSelect(item, idx, mouseBounds)}
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
