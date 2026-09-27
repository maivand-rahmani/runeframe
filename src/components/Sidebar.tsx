import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { LAYOUT } from '../constants.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import {
  useFocusZone,
  useFocusGroup,
  useFocusable,
} from '../interaction/FocusTreeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'
import { useNavigation } from '../navigation/NavigationProvider.js'

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
}

const DEFAULT_CATEGORY = 'default'

function SidebarEntry({
  item,
  active,
  showDescription,
  groupActive,
}: {
  item: SidebarItem
  active: boolean
  showDescription: boolean
  groupActive: boolean
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

  return (
    <Box flexDirection="column" marginTop={theme.spacing.xs}>
      <Text color={labelColor} bold={active || (focused && groupActive)}>
        {marker} {item.label}
      </Text>
      {showDescription && item.description != null && item.description.length > 0 && (
        <Text color={theme.colors.text.secondary}>  {item.description}</Text>
      )}
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
}: SidebarProps) {
  const { columns: detectedColumns } = useWindowSize()
  const columns = columnsOverride ?? detectedColumns ?? LAYOUT.medium
  const theme = useTheme()
  const { currentScreenId, push } = useNavigation()
  const hasActiveItem = items.some((item) => item.id === currentScreenId)
  const zoneId = useId()
  const { ZoneProvider } = useFocusZone(zoneId, {
    scope: 'navigation',
    orientation: 'horizontal',
    order: 0,
  })
  const { GroupProvider, focusedId, isActive: groupActive } = useFocusGroup(
    'sidebar',
    {
      autoFocus: !hasActiveItem,
      scope: 'navigation',
    },
  )
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

  useKeyHandler(
    (event) => {
      if (!groupActive) return InputConsumptionResult.NotConsumed
      if (!event.enter) return InputConsumptionResult.NotConsumed
      const targetId = focusedIdRef.current ?? firstItemIdRef.current
      if (!targetId) return InputConsumptionResult.NotConsumed
      if (targetId !== currentScreenIdRef.current) {
        pushRef.current(targetId)
      }
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
        <Box flexDirection="column">
          {visibleGroups.map(({ category, items: categoryItems }, categoryIndex) => {
            return (
              <Box
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
                  />
                ))}
              </Box>
            )
          })}
          {footer != null && <Box marginTop={theme.spacing.sm}>{footer}</Box>}
        </Box>
      </GroupProvider>
    </ZoneProvider>
  )
}
