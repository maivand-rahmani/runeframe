import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { LAYOUT } from '../../constants.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  useFocusZone,
  useFocusGroup,
  useFocusable,
} from '../../interaction/focus/FocusTreeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { InputConsumptionResult } from '../../types.js'
import { useNavigation } from '../../navigation/NavigationProvider.js'
import { MouseArea } from '../../interaction/mouse/MouseArea.js'
import type { MouseBounds } from '../../interaction/mouse/MouseArea.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

export interface SidebarItem {
  id: string
  label: string
  description?: string
  category?: string
}

export type SidebarSectionTitles = Record<string, string>

export interface SidebarProps {
  items: SidebarItem[]
  sectionTitles?: SidebarSectionTitles
  columns?: number
  categoryOrder?: string[]
  screenOrderByCategory?: Record<string, string[]>
  footer?: ReactNode
  /** The index is from the input items array, before sidebar grouping/order. */
  mouseBoundsForItem?: (item: SidebarItem, index: number) => MouseBounds | undefined
}

const DEFAULT_CATEGORY = 'default'

function SidebarEntry({
  item,
  active,
  showDescription,
  groupActive,
  mouseBounds,
  autoMouseEnabled,
  onMouseActivate,
  onAutoMouseActivate,
}: {
  item: SidebarItem
  active: boolean
  showDescription: boolean
  groupActive: boolean
  mouseBounds?: MouseBounds
  autoMouseEnabled: boolean
  onMouseActivate?: (
    focusItem: () => void,
    renderedBounds: MouseBounds,
  ) => void
  onAutoMouseActivate?: (focusItem: () => void) => void
}) {
  const theme = useTheme()
  const { focused, onActivate } = useFocusable({ id: item.id })
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (active) {
      onActivateRef.current()
    }
  }, [active])

  const marker = focused ? '›' : active ? '•' : ' '
  const labelColor = groupActive
    ? active
      ? theme.colors.focus.active
      : focused
        ? theme.colors.focus.ring
        : theme.colors.text.primary
    : active
      ? theme.colors.focus.active
      : theme.colors.text.muted

  const rowContents = (
    <>
      <Text color={labelColor} bold={active || (focused && groupActive)}>
        {marker} {item.label}
      </Text>
      {showDescription && item.description != null && item.description.length > 0 && (
        <Text color={theme.colors.text.secondary}>  {item.description}</Text>
      )}
    </>
  )

  if (mouseBounds != null) {
    return (
      <MouseArea
        bounds={mouseBounds}
        onClick={() => onMouseActivate?.(onActivate, mouseBounds)}
      >
        <Box flexDirection="column" marginTop={theme.spacing.xs}>
          {rowContents}
        </Box>
      </MouseArea>
    )
  }

  if (autoMouseEnabled) {
    return (
      <SidebarAutoRow
        marginTop={theme.spacing.xs}
        onClick={() => onAutoMouseActivate?.(onActivate)}
      >
        {rowContents}
      </SidebarAutoRow>
    )
  }

  return (
    <Box flexDirection="column" marginTop={theme.spacing.xs}>
      {rowContents}
    </Box>
  )
}

function SidebarAutoRow({
  children,
  marginTop,
  onClick,
}: {
  children: ReactNode
  marginTop: number
  onClick: () => void
}) {
  const ref = useAutoMouseArea({ onClick })
  return (
    <Box ref={ref} flexDirection="column" marginTop={marginTop}>
      {children}
    </Box>
  )
}

export function Sidebar({
  items,
  sectionTitles,
  columns: columnsOverride,
  categoryOrder,
  screenOrderByCategory,
  footer,
  mouseBoundsForItem,
}: SidebarProps) {
  const { columns: detectedColumns } = useWindowSize()
  const columns = columnsOverride ?? detectedColumns ?? LAYOUT.medium
  const theme = useTheme()
  const { currentScreenId, push } = useNavigation()
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const hasActiveItem = items.some((item) => item.id === currentScreenId)
  const zoneId = useId()
  const { ZoneProvider } = useFocusZone(zoneId, {
    scope: 'navigation',
    orientation: 'horizontal',
    order: 0,
  })
  const {
    GroupProvider,
    focusedId,
    isActive: groupActive,
    activate: groupActivate,
  } = useFocusGroup('sidebar', {
    autoFocus: !hasActiveItem,
    scope: 'navigation',
  })
  const showDescriptions = columns >= LAYOUT.medium
  const inputOrder = new Map(items.map((item, index) => [item.id, index]))

  // Handler state is kept in refs so keyboard registration is stable.
  const focusedIdRef = useRef(focusedId)
  focusedIdRef.current = focusedId
  const firstItemIdRef = useRef<string | null>(items[0]?.id ?? null)
  firstItemIdRef.current = items[0]?.id ?? null
  const currentScreenIdRef = useRef(currentScreenId)
  currentScreenIdRef.current = currentScreenId
  const pushRef = useRef(push)
  pushRef.current = push
  const itemsRef = useRef(items)
  itemsRef.current = items
  const mouseBoundsForItemRef = useRef(mouseBoundsForItem)
  mouseBoundsForItemRef.current = mouseBoundsForItem
  const autoMouseEnabled =
    mouseBoundsForItem == null &&
    mouseGeometry != null &&
    mouseRegistry != null
  const activateGroupRef = useRef<() => void>(() => {})
  activateGroupRef.current = groupActivate

  function activateSidebarItem(id: string) {
    if (!itemsRef.current.some((item) => item.id === id)) return false
    if (id !== currentScreenIdRef.current) pushRef.current(id)
    return true
  }

  function handleMouseActivate(
    id: string,
    focusItem: () => void,
    renderedBounds?: MouseBounds,
  ) {
    const index = itemsRef.current.findIndex((item) => item.id === id)
    if (index < 0) return
    const item = itemsRef.current[index]
    const resolver = mouseBoundsForItemRef.current
    if (renderedBounds != null) {
      const currentBounds = resolver?.(item, index)
      // Do not honor a stale row callback after it has been removed or lost its
      // explicit geometry.
      if (
        currentBounds == null ||
        !sameMouseBounds(currentBounds, renderedBounds)
      ) {
        return
      }
    }

    activateGroupRef.current()
    focusItem()
    activateSidebarItem(id)
  }

  useKeyHandler(
    (event) => {
      if (!groupActive) return InputConsumptionResult.NotConsumed
      if (!event.enter) return InputConsumptionResult.NotConsumed
      const targetId = focusedIdRef.current ?? firstItemIdRef.current
      if (!targetId) return InputConsumptionResult.NotConsumed
      if (!activateSidebarItem(targetId)) return InputConsumptionResult.NotConsumed
      return InputConsumptionResult.Consumed
    },
    'navigation',
  )

  const allCategories = new Set<string>([
    ...(categoryOrder ?? []),
    ...items.map((item) => item.category ?? DEFAULT_CATEGORY),
  ])

  const orderedCategories = [...allCategories].sort((left, right) => {
    const leftIndex = categoryOrder?.indexOf(left) ?? -1
    const rightIndex = categoryOrder?.indexOf(right) ?? -1
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    }
    return left.localeCompare(right)
  })

  const groupedItems = orderedCategories.map((category) => {
    const screenOrder = screenOrderByCategory?.[category] ?? []
    const ordered = items
      .filter((item) => (item.category ?? DEFAULT_CATEGORY) === category)
      .sort((left, right) => {
        const leftCategoryIndex = screenOrder.indexOf(left.id)
        const rightCategoryIndex = screenOrder.indexOf(right.id)
        const leftIndex =
          leftCategoryIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCategoryIndex
        const rightIndex =
          rightCategoryIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCategoryIndex

        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex
        }

        return (inputOrder.get(left.id) ?? 0) - (inputOrder.get(right.id) ?? 0)
      })

    return { category, items: ordered }
  })
  const visibleGroups = groupedItems.filter((group) => group.items.length > 0)

  return (
    <ZoneProvider>
      <GroupProvider>
        <MouseLayout flexDirection="column">
          {visibleGroups.map(({ category, items: categoryItems }, categoryIndex) => {
            return (
              <MouseLayout
                key={category}
                flexDirection="column"
                marginBottom={
                  categoryIndex < visibleGroups.length - 1 ? theme.spacing.sm : 0
                }
              >
                <Text bold color={theme.colors.text.muted}>
                  {sectionTitles?.[category] ?? category.toUpperCase()}
                </Text>
                {categoryItems.map((item) => (
                  <SidebarEntry
                    key={item.id}
                    item={item}
                    active={item.id === currentScreenId}
                    showDescription={showDescriptions}
                    groupActive={groupActive}
                    autoMouseEnabled={autoMouseEnabled}
                    mouseBounds={mouseBoundsForItem?.(
                      item,
                      inputOrder.get(item.id) ?? -1,
                    )}
                    onMouseActivate={(focusItem, renderedBounds) =>
                      handleMouseActivate(item.id, focusItem, renderedBounds)
                    }
                    onAutoMouseActivate={(focusItem) =>
                      handleMouseActivate(item.id, focusItem)
                    }
                  />
                ))}
              </MouseLayout>
            )
          })}
          {footer != null && (
            <MouseLayout marginTop={theme.spacing.sm}>{footer}</MouseLayout>
          )}
        </MouseLayout>
      </GroupProvider>
    </ZoneProvider>
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
