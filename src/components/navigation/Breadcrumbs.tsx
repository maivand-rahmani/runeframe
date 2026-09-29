import { useRef } from 'react'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  useNavigation,
  type NavigationEntry,
} from '../../navigation/NavigationProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

export interface BreadcrumbsProps {
  onSelect?: (screenId: string) => void
  maxItems?: number
  separator?: string
}

export function Breadcrumbs({
  onSelect,
  maxItems = 5,
  separator = ' > ',
}: BreadcrumbsProps) {
  const { breadcrumbs, registry } = useNavigation()
  const { colors } = useTheme()
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const itemKeysRef = useRef({
    next: 0,
    byEntry: new WeakMap<NavigationEntry, string>(),
  })

  const allItems = breadcrumbs.map((b) => {
    let key = itemKeysRef.current.byEntry.get(b)
    if (key === undefined) {
      key = `entry-${itemKeysRef.current.next++}`
      itemKeysRef.current.byEntry.set(b, key)
    }
    return {
      id: b.screenId,
      title: registry.get(b.screenId).title,
      key,
    }
  })

  const items =
    allItems.length <= maxItems
      ? allItems
      : [
          allItems[0],
          ...(maxItems > 2
            ? [{ id: '', title: '...', key: 'ellipsis' } as const]
            : []),
          allItems[allItems.length - 1],
        ]

  const elements: ReactElement[] = []
  const autoMouseEnabled =
    onSelect != null &&
    mouseGeometry != null &&
    mouseGeometry.origin != null &&
    mouseGeometry.clip != null &&
    mouseRegistry != null
  const hasClickableItem = items.some(
    (item, index) => index < items.length - 1 && item.id !== '',
  )

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const isLast = i === items.length - 1

    if (i > 0) {
      elements.push(
        <Text key={`sep-${i}`} color={colors.text.secondary}>
          {separator}
        </Text>,
      )
    }

    const color = isLast ? colors.focus.active : colors.text.secondary
    const dimColor = !isLast && item.title === '...'
    const elementKey =
      autoMouseEnabled && !isLast && item.id !== ''
        ? `bc-${item.key}`
        : `bc-${item.id || '...'}-${i}`
    elements.push(
      autoMouseEnabled && !isLast && item.id !== '' ? (
        <BreadcrumbMouseTarget
          key={elementKey}
          id={item.id}
          title={item.title}
          color={color}
          onSelect={onSelect}
        />
      ) : (
        <Text
          key={elementKey}
          color={color}
          dimColor={dimColor}
        >
          {item.title}
        </Text>
      ),
    )
  }

  // Text has no public DOMElement ref in Ink 7. Only the anchored mouse path
  // uses visible Box-equivalent targets for prior segments. This changes layout
  // nodes only in that path and can affect wrapping in constrained rows; the
  // legacy Text tree remains unchanged otherwise.
  return autoMouseEnabled && hasClickableItem ? (
    <MouseLayout flexDirection="row">{elements}</MouseLayout>
  ) : (
    <Text>{elements}</Text>
  )
}

function BreadcrumbMouseTarget({
  id,
  title,
  color,
  onSelect,
}: {
  id: string
  title: string
  color: string
  onSelect?: (screenId: string) => void
}) {
  const ref = useAutoMouseArea({ onClick: () => onSelect?.(id) })
  return (
    <MouseLayout ref={ref}>
      <Text color={color}>{title}</Text>
    </MouseLayout>
  )
}
