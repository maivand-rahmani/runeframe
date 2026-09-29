import { useRef, useEffect, useCallback, type ReactElement } from 'react'
import { Box, Text } from 'ink'
import {
  useFocusGroup,
  useFocusable,
} from '../interaction/FocusTreeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { LAYOUT } from '../constants.js'
import { InputConsumptionResult } from '../types.js'
import { MouseArea } from '../interaction/MouseArea.js'
import type { MouseBounds } from '../interaction/MouseArea.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/MouseProvider.js'

// ── Data Types ──

export interface ListItem {
  id: string
  label: string
  description?: string
}

export interface ListProps<T extends ListItem> {
  items: T[]
  selectedId?: string
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  maxVisible?: number
  mouseBoundsForItem?: (item: T, index: number) => MouseBounds | undefined
  renderItem?: (
    item: T,
    state: { focused: boolean; selected: boolean },
  ) => ReactElement
}

// ── Public Component ──

export function List<T extends ListItem>({
  items,
  selectedId,
  onSelect,
  onActivate,
  maxVisible = LAYOUT.listMaxVisible,
  mouseBoundsForItem,
  renderItem,
}: ListProps<T>) {
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled =
    mouseBoundsForItem == null &&
    mouseGeometry != null &&
    mouseRegistry != null
  const safeMaxVisible = Math.max(1, maxVisible)
  const displayItems =
    items.length > safeMaxVisible
      ? items.slice(0, safeMaxVisible)
      : items

  const {
    GroupProvider,
    focusedId,
    activate: activateGroup,
  } = useFocusGroup('list', {
    autoFocus: true,
    scope: 'list',
  })

  // Handler state is kept in refs so keyboard registration is stable.
  const focusedIdRef = useRef(focusedId)
  focusedIdRef.current = focusedId
  const firstItemIdRef = useRef<string | null>(items[0]?.id ?? null)
  firstItemIdRef.current = items[0]?.id ?? null
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const activateGroupRef = useRef(activateGroup)
  activateGroupRef.current = activateGroup
  const displayItemsRef = useRef(displayItems)
  displayItemsRef.current = displayItems
  const mouseBoundsForItemRef = useRef(mouseBoundsForItem)
  mouseBoundsForItemRef.current = mouseBoundsForItem
  const prevFocusedIdRef = useRef<string | null>(null)
  const skipMouseFocusSelectRef = useRef<string | null>(null)

  const handleMouseSelect = useCallback(
    (id: string, focusItem: () => void, renderedBounds: MouseBounds) => {
      const index = displayItemsRef.current.findIndex((item) => item.id === id)
      if (index < 0) return

      const item = displayItemsRef.current[index]
      const resolver = mouseBoundsForItemRef.current
      const currentBounds = resolver?.(item, index)
      // Ignore callbacks retained by an old row after it has been removed,
      // filtered out, or had its explicit geometry removed.
      if (
        currentBounds == null ||
        !sameMouseBounds(currentBounds, renderedBounds)
      ) {
        return
      }

      activateGroupRef.current()
      if (focusedIdRef.current !== id) skipMouseFocusSelectRef.current = id
      focusItem()
      onSelectRef.current?.(id)
    },
    [],
  )

  const handleAutoMouseSelect = useCallback(
    (id: string, focusItem: () => void) => {
      if (!displayItemsRef.current.some((item) => item.id === id)) return

      activateGroupRef.current()
      if (focusedIdRef.current !== id) skipMouseFocusSelectRef.current = id
      focusItem()
      onSelectRef.current?.(id)
    },
    [],
  )

  useKeyHandler(
    (event) => {
      if (!event.enter) return InputConsumptionResult.NotConsumed
      if (!onActivateRef.current) return InputConsumptionResult.NotConsumed
      const targetId = focusedIdRef.current ?? firstItemIdRef.current
      if (!targetId) return InputConsumptionResult.NotConsumed
      onActivateRef.current(targetId)
      return InputConsumptionResult.Consumed
    },
    'list',
  )

  // `onSelect` observes roving focus once it leaves the initial item.
  useEffect(() => {
    if (focusedId !== prevFocusedIdRef.current) {
      if (prevFocusedIdRef.current !== null && focusedId !== null) {
        if (skipMouseFocusSelectRef.current !== focusedId) {
          onSelectRef.current?.(focusedId)
        }
      }
      skipMouseFocusSelectRef.current = null
    }
    prevFocusedIdRef.current = focusedId
  }, [focusedId])

  if (items.length === 0) {
    return <Text dimColor>No items</Text>
  }

  return (
    <GroupProvider>
      <MouseLayout flexDirection="column">
        {displayItems.map((item, index) => (
          <ListItemRow
            key={item.id}
            item={item}
            selectedId={selectedId}
            mouseBounds={mouseBoundsForItem?.(item, index)}
            autoMouseEnabled={autoMouseEnabled}
            onMouseSelect={handleMouseSelect}
            onAutoMouseSelect={handleAutoMouseSelect}
            renderItem={
              renderItem as
                | ((
                    item: ListItem,
                    state: { focused: boolean; selected: boolean },
                  ) => ReactElement)
                | undefined
            }
          />
        ))}
      </MouseLayout>
    </GroupProvider>
  )
}

// ── Internal Helpers ──

interface ListItemRowProps {
  item: ListItem
  selectedId?: string
  mouseBounds?: MouseBounds
  autoMouseEnabled: boolean
  onMouseSelect?: (
    id: string,
    focusItem: () => void,
    renderedBounds: MouseBounds,
  ) => void
  onAutoMouseSelect?: (id: string, focusItem: () => void) => void
  renderItem?: (
    item: ListItem,
    state: { focused: boolean; selected: boolean },
  ) => ReactElement
}

function ListItemRow({
  item,
  selectedId,
  mouseBounds,
  autoMouseEnabled,
  onMouseSelect,
  onAutoMouseSelect,
  renderItem,
}: ListItemRowProps) {
  const { colors } = useTheme()
  const { focused, onActivate } = useFocusable({ id: item.id })
  const isSelected = selectedId === item.id

  let rowContents: ReactElement
  let flexDirection: 'column' | undefined
  if (renderItem) {
    rowContents = renderItem(item, { focused, selected: isSelected })
  } else {
    const labelColor = focused
      ? colors.focus.ring
      : isSelected
        ? colors.focus.active
        : colors.text.primary

    rowContents = (
      <>
        <Box>
          <Text color={labelColor} bold={isSelected}>
            {isSelected ? '• ' : '  '}
            {item.label}
          </Text>
        </Box>
        {item.description && (
          <Box>
            <Text color={colors.text.secondary}>
              {'  '}
              {item.description}
            </Text>
          </Box>
        )}
      </>
    )
    flexDirection = 'column'
  }

  if (mouseBounds != null) {
    return (
      <MouseArea
        bounds={mouseBounds}
        onClick={() => onMouseSelect?.(item.id, onActivate, mouseBounds)}
      >
        <Box flexDirection={flexDirection}>{rowContents}</Box>
      </MouseArea>
    )
  }

  if (autoMouseEnabled) {
    return (
      <AutoListItemRow
        flexDirection={flexDirection}
        onClick={() => onAutoMouseSelect?.(item.id, onActivate)}
      >
        {rowContents}
      </AutoListItemRow>
    )
  }

  return <Box flexDirection={flexDirection}>{rowContents}</Box>
}

function AutoListItemRow({
  children,
  flexDirection,
  onClick,
}: {
  children: ReactElement
  flexDirection?: 'column'
  onClick: () => void
}) {
  const ref = useAutoMouseArea({ onClick })
  return (
    <Box ref={ref} flexDirection={flexDirection}>
      {children}
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
