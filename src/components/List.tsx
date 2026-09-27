import { useRef, useEffect, type ReactElement } from 'react'
import { Box, Text } from 'ink'
import {
  useFocusGroup,
  useFocusable,
} from '../interaction/FocusTreeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import { LAYOUT } from '../constants.js'
import { InputConsumptionResult } from '../types.js'

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
  renderItem,
}: ListProps<T>) {
  const safeMaxVisible = Math.max(1, maxVisible)
  const displayItems =
    items.length > safeMaxVisible
      ? items.slice(0, safeMaxVisible)
      : items

  const { GroupProvider, focusedId } = useFocusGroup('list', {
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
  const prevFocusedIdRef = useRef<string | null>(null)

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
    if (
      prevFocusedIdRef.current !== null &&
      focusedId !== null &&
      focusedId !== prevFocusedIdRef.current
    ) {
      onSelectRef.current?.(focusedId)
    }
    prevFocusedIdRef.current = focusedId
  }, [focusedId])

  if (items.length === 0) {
    return <Text dimColor>No items</Text>
  }

  return (
    <GroupProvider>
      <Box flexDirection="column">
        {displayItems.map((item) => (
          <ListItemRow
            key={item.id}
            item={item}
            selectedId={selectedId}
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
      </Box>
    </GroupProvider>
  )
}

// ── Internal Helpers ──

interface ListItemRowProps {
  item: ListItem
  selectedId?: string
  renderItem?: (
    item: ListItem,
    state: { focused: boolean; selected: boolean },
  ) => ReactElement
}

function ListItemRow({ item, selectedId, renderItem }: ListItemRowProps) {
  const { colors } = useTheme()
  const { focused } = useFocusable({ id: item.id })
  const isSelected = selectedId === item.id

  if (renderItem) {
    return <Box>{renderItem(item, { focused, selected: isSelected })}</Box>
  }

  const labelColor = focused
    ? colors.focus.ring
    : isSelected
      ? colors.focus.active
      : colors.text.primary

  return (
    <Box flexDirection="column">
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
    </Box>
  )
}
