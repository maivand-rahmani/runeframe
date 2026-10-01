import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../primitives/themeOverrides.js'
import { List, type ListItem, type ListProps } from './List.js'

export interface SelectableListProps<T extends ListItem>
  extends Omit<ListProps<T>, 'items'> {
  items: T[]
  filterQuery?: string
  filterFn?: (item: T, query: string) => boolean
  /** Bounds are resolved for visible filtered rows, using their displayed index. */
  mouseBoundsForItem?: ListProps<T>['mouseBoundsForItem']
}

function defaultFilter<T extends ListItem>(
  item: T,
  query: string,
): boolean {
  const q = query.toLowerCase()
  return (
    item.label.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q)
  )
}

export function SelectableList<T extends ListItem>({
  items,
  filterQuery,
  filterFn = defaultFilter,
  ...listProps
}: SelectableListProps<T>) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'selectableList')
  const filteredItems = filterQuery
    ? items.filter((item) => filterFn(item, filterQuery))
    : items

  if (filteredItems.length === 0) {
    return (
      <Box>
        <Text dimColor color={overrides?.colors?.empty}>
          No results
        </Text>
      </Box>
    )
  }

  return <List {...(listProps as ListProps<T>)} items={filteredItems} />
}
