import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Box, Text } from 'ink'
import {
  useFocusGroup,
  useFocusable,
} from '../../interaction/focus/FocusTreeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'
import { LAYOUT } from '../../constants.js'
import { InputConsumptionResult } from '../../types.js'
import { MouseArea } from '../../interaction/mouse/MouseArea.js'
import type { MouseBounds } from '../../interaction/mouse/MouseArea.js'
import { MouseScrollLayout } from '../../interaction/mouse/MouseScrollLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

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
    state: { focused: boolean; selected: boolean; hovered: boolean },
  ) => ReactElement
}

// ── Public Component ──

export function List<T extends ListItem>({
  items,
  selectedId,
  onSelect,
  onActivate,
  maxVisible,
  mouseBoundsForItem,
  renderItem,
}: ListProps<T>) {
  const theme = useTheme()
  const resolvedMaxVisible =
    maxVisible ??
    componentLayoutNumber(
      theme,
      'list',
      'maxVisible',
      theme.layout?.listMaxVisible ?? LAYOUT.listMaxVisible,
    )
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled =
    mouseBoundsForItem == null &&
    mouseGeometry != null &&
    mouseRegistry != null
  const safeMaxVisible = Math.max(1, resolvedMaxVisible)
  const maxScrollOffset = Math.max(0, items.length - safeMaxVisible)
  const [scrollOffset, setScrollOffset] = useState(0)
  const scrollOffsetRef = useRef(scrollOffset)
  scrollOffsetRef.current = scrollOffset
  const maxScrollOffsetRef = useRef(maxScrollOffset)
  maxScrollOffsetRef.current = maxScrollOffset
  const visibleItems = items.slice(scrollOffset, scrollOffset + safeMaxVisible)

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
  const itemsRef = useRef(items)
  itemsRef.current = items
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const activateGroupRef = useRef(activateGroup)
  activateGroupRef.current = activateGroup
  const visibleItemsRef = useRef(visibleItems)
  visibleItemsRef.current = visibleItems
  const mouseBoundsForItemRef = useRef(mouseBoundsForItem)
  mouseBoundsForItemRef.current = mouseBoundsForItem
  const prevFocusedIdRef = useRef<string | null>(null)
  const skipMouseFocusSelectRef = useRef<string | null>(null)

  // Keep the focused item mounted inside the visible window. Focus can move
  // through every item even though only the visible rows render Ink content.
  useLayoutEffect(() => {
    setScrollOffset((current) => {
      let next = Math.min(current, maxScrollOffset)
      const focusedIndex = items.findIndex((item) => item.id === focusedId)
      if (focusedIndex >= 0) {
        if (focusedIndex < next) next = focusedIndex
        else if (focusedIndex >= next + safeMaxVisible) {
          next = focusedIndex - safeMaxVisible + 1
        }
      }
      return next
    })
  }, [focusedId, items, maxScrollOffset, safeMaxVisible])

  const handleWheel = useCallback((direction: 'up' | 'down'): boolean => {
    const current = scrollOffsetRef.current
    const next = Math.max(
      0,
      Math.min(
        maxScrollOffsetRef.current,
        current + (direction === 'down' ? 1 : -1),
      ),
    )
    if (next === current) return false
    // Apply same-frame wheel reports against the latest committed offset.
    scrollOffsetRef.current = next
    setScrollOffset(next)
    return true
  }, [])

  const handleMouseSelect = useCallback(
    (
      id: string,
      index: number,
      focusItem: () => void,
      renderedBounds: MouseBounds,
    ) => {
      const item = itemsRef.current[index]
      if (
        item?.id !== id ||
        index < scrollOffsetRef.current ||
        index >= scrollOffsetRef.current + safeMaxVisible
      ) {
        return
      }
      const visibleIndex = index - scrollOffsetRef.current
      const resolver = mouseBoundsForItemRef.current
      const currentBounds = resolver?.(item, visibleIndex)
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
    [safeMaxVisible],
  )

  const handleAutoMouseSelect = useCallback(
    (id: string, focusItem: () => void) => {
      if (!visibleItemsRef.current.some((item) => item.id === id)) return

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
      <MouseScrollLayout
        flexDirection="column"
        onWheel={items.length > safeMaxVisible ? handleWheel : undefined}
      >
        {items.map((item, index) => {
          const visible =
            items.length <= safeMaxVisible ||
            (index >= scrollOffset && index < scrollOffset + safeMaxVisible)
          return (
            <ListItemRow
              key={item.id}
              item={item}
              index={index}
              visible={visible}
              selectedId={selectedId}
              mouseBounds={
                visible
                  ? mouseBoundsForItem?.(item, index - scrollOffset)
                  : undefined
              }
              autoMouseEnabled={autoMouseEnabled}
              onMouseSelect={handleMouseSelect}
              onAutoMouseSelect={handleAutoMouseSelect}
              renderItem={
                renderItem as
                  | ((
                      item: ListItem,
                      state: {
                        focused: boolean
                        selected: boolean
                        hovered: boolean
                      },
                    ) => ReactElement)
                  | undefined
              }
            />
          )
        })}
      </MouseScrollLayout>
    </GroupProvider>
  )
}

// ── Internal Helpers ──

interface ListItemRowProps {
  item: ListItem
  index: number
  visible: boolean
  selectedId?: string
  mouseBounds?: MouseBounds
  autoMouseEnabled: boolean
  onMouseSelect?: (
    id: string,
    index: number,
    focusItem: () => void,
    renderedBounds: MouseBounds,
  ) => void
  onAutoMouseSelect?: (id: string, focusItem: () => void) => void
  renderItem?: (
    item: ListItem,
    state: { focused: boolean; selected: boolean; hovered: boolean },
  ) => ReactElement
}

function ListItemRow({
  item,
  index,
  visible,
  selectedId,
  mouseBounds,
  autoMouseEnabled,
  onMouseSelect,
  onAutoMouseSelect,
  renderItem,
}: ListItemRowProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'list')
  const marker = overrides?.symbols?.marker ?? theme.symbols?.list.marker ?? '•'
  const markerCell = `${marker} `
  const blankCell = ' '.repeat(marker.length + 1)
  const descriptionIndent = ' '.repeat(
    overrides?.spacing?.descriptionIndent ?? theme.spacing.sm,
  )
  const focusRing = overrides?.colors?.focused ?? theme.colors.focus.ring
  const focusActive = overrides?.colors?.selected ?? theme.colors.focus.active
  const focusSelected = overrides?.colors?.hovered ?? theme.colors.focus.selected
  const textPrimary = overrides?.colors?.label ?? theme.colors.text.primary
  const textSecondary =
    overrides?.colors?.description ?? theme.colors.text.secondary
  const { focused, onActivate } = useFocusable({ id: item.id })
  const isSelected = selectedId === item.id
  const [hovered, setHovered] = useState(false)

  if (!visible) return null

  let rowContents: ReactElement
  let flexDirection: 'column' | undefined
  if (renderItem) {
    const renderedItem = renderItem(item, {
      focused,
      selected: isSelected,
      hovered,
    })
    rowContents = hovered ? underlineText(renderedItem) : renderedItem
  } else {
    const labelColor = focused
      ? focusRing
      : isSelected
        ? focusActive
        : hovered
          ? focusSelected
          : textPrimary

    rowContents = (
      <>
        <Box>
          <Text color={labelColor} bold={isSelected} underline={hovered}>
            {isSelected ? markerCell : blankCell}
            {item.label}
          </Text>
        </Box>
        {item.description && (
          <Box>
            <Text color={textSecondary}>
              {descriptionIndent}
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
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
        onClick={() =>
          onMouseSelect?.(item.id, index, onActivate, mouseBounds)
        }
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
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
      >
        {rowContents}
      </AutoListItemRow>
    )
  }

  return <Box flexDirection={flexDirection}>{rowContents}</Box>
}

/**
 * Custom rows keep control of their colors and layout, while still getting an
 * orthogonal hover cue. Walking the returned Ink tree avoids adding a marker
 * column or changing the row's measured mouse target.
 */
function underlineText(node: ReactElement): ReactElement {
  const element = node as ReactElement<{
    children?: ReactNode
    underline?: boolean
  }>
  const children =
    element.props.children === undefined
      ? undefined
      : Children.map(element.props.children, (child) =>
          isValidElement(child) ? underlineText(child) : child,
        )

  if (node.type === Text) {
    return cloneElement(element, { underline: true, children })
  }

  if (children === undefined) return node
  return cloneElement(element, { children })
}

function AutoListItemRow({
  children,
  flexDirection,
  onClick,
  onEnter,
  onLeave,
}: {
  children: ReactElement
  flexDirection?: 'column'
  onClick: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  const ref = useAutoMouseArea({ onClick, onEnter, onLeave })
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
