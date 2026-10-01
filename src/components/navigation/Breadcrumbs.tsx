import { useRef, useState } from 'react'
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
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'

export interface BreadcrumbsProps {
  onSelect?: (screenId: string) => void
  maxItems?: number
  separator?: string
}

export function Breadcrumbs({
  onSelect,
  maxItems,
  separator,
}: BreadcrumbsProps) {
  const { breadcrumbs, registry } = useNavigation()
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'breadcrumbs')
  const resolvedSeparator =
    separator ?? overrides?.symbols?.separator ?? ' > '
  const resolvedMaxItems =
    maxItems ??
    componentLayoutNumber(theme, 'breadcrumbs', 'maxItems', 5)
  const itemColor = overrides?.colors?.item ?? colors.text.secondary
  const currentColor = overrides?.colors?.current ?? colors.focus.active
  const hoverColor = overrides?.colors?.hover ?? colors.focus.ring
  const separatorColor = overrides?.colors?.separator ?? colors.text.secondary
  const ellipsis = overrides?.symbols?.ellipsis ?? '...'
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
    allItems.length <= resolvedMaxItems
      ? allItems
      : [
          allItems[0],
          ...(resolvedMaxItems > 2
            ? [{ id: '', title: ellipsis, key: 'ellipsis' } as const]
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
        <Text key={`sep-${i}`} color={separatorColor}>
          {resolvedSeparator}
        </Text>,
      )
    }

    const color = isLast ? currentColor : itemColor
    const dimColor = !isLast && item.title === ellipsis
    const elementKey =
      autoMouseEnabled && !isLast && item.id !== ''
        ? `bc-${item.key}`
        : `bc-${item.id || ellipsis}-${i}`
    elements.push(
      autoMouseEnabled && !isLast && item.id !== '' ? (
        <BreadcrumbMouseTarget
          key={elementKey}
          id={item.id}
          title={item.title}
          color={color}
          hoverColor={hoverColor}
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
  hoverColor,
  onSelect,
}: {
  id: string
  title: string
  color: string
  hoverColor: string
  onSelect?: (screenId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const ref = useAutoMouseArea({
    onClick: () => onSelect?.(id),
    onEnter: () => setHovered(true),
    onLeave: () => setHovered(false),
  })
  return (
    <MouseLayout ref={ref}>
      <Text color={hovered ? hoverColor : color} underline={hovered}>
        {title}
      </Text>
    </MouseLayout>
  )
}
