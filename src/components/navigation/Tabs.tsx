import { Text } from 'ink'
import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import type { FocusScope } from '../../types.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

export interface Tab {
  id: string
  label: string
  description?: string
}

export interface TabsProps {
  tabs: Tab[]
  activeTabId: string
  onChange: (id: string) => void
  scope?: FocusScope
}

function truncateLabel(
  label: string,
  availableWidth: number,
): string {
  if (availableWidth <= 0) return ''
  if (label.length <= availableWidth) return label
  return label.slice(0, Math.max(1, availableWidth - 1)) + '…'
}

export function Tabs({
  tabs,
  activeTabId,
  onChange,
  scope = 'list',
}: TabsProps): ReactElement | null {
  const { colors } = useTheme()
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled =
    mouseGeometry != null &&
    mouseGeometry.origin != null &&
    mouseGeometry.clip != null &&
    mouseRegistry != null
  const columns = process.stdout.columns ?? 80

  // Use refs so the input handler always reads the latest values
  // without needing to re-register (which creates a gap between cleanup and setup).
  // Publish updates only after commit so an interrupted render cannot change
  // what an already-registered keyboard handler observes.
  const activeTabIdRef = useRef(activeTabId)
  const onChangeRef = useRef(onChange)
  const tabsRef = useRef(tabs)
  useLayoutEffect(() => {
    activeTabIdRef.current = activeTabId
    onChangeRef.current = onChange
    tabsRef.current = tabs
  }, [activeTabId, onChange, tabs])

  useKeyHandler(
    (event) => {
      const currentTabs = tabsRef.current
      const currentId = activeTabIdRef.current
      const currentOnChange = onChangeRef.current

      if (currentTabs.length === 0) return

      if (event.left) {
        const currentIndex = currentTabs.findIndex((t) => t.id === currentId)
        if (currentIndex === -1) return
        const prevIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length
        currentOnChange(currentTabs[prevIndex].id)
        return true
      } else if (event.right) {
        const currentIndex = currentTabs.findIndex((t) => t.id === currentId)
        if (currentIndex === -1) return
        const nextIndex = (currentIndex + 1) % currentTabs.length
        currentOnChange(currentTabs[nextIndex].id)
        return true
      }
    },
    scope,
    { deps: [tabs, activeTabId, onChange], priority: 40 },
  )

  if (tabs.length === 0) return null

  const separatorText = ' | '
  const separatorWidth = separatorText.length
  const totalSeparatorWidth = separatorWidth * Math.max(0, tabs.length - 1)
  const perTabWidth = Math.max(
    1,
    Math.floor((columns - totalSeparatorWidth) / tabs.length),
  )

  const elements: ReactElement[] = []

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]
    const isActive = tab.id === activeTabId

    if (i > 0) {
      elements.push(
        <Text key={`sep-${i}`} color={colors.text.muted}>
          {separatorText}
        </Text>,
      )
    }

    const label = truncateLabel(tab.label, perTabWidth)
    elements.push(
      autoMouseEnabled ? (
        <TabMouseTarget
          key={`tab-${tab.id}`}
          id={tab.id}
          label={label}
          active={isActive}
          scope={scope}
          color={isActive ? colors.focus.active : colors.text.secondary}
          onChange={onChange}
        />
      ) : (
        <Text
          key={`tab-${tab.id}`}
          bold={isActive}
          color={isActive ? colors.focus.active : colors.text.secondary}
        >
          {label}
        </Text>
      ),
    )
  }

  // Text has no public DOMElement ref in Ink 7. In the opt-in mouse tree, each
  // tab therefore gets one visible Box-equivalent target. This changes the
  // layout nodes only in this path and can affect wrapping in constrained rows;
  // outside it, keep the legacy Text tree unchanged.
  return autoMouseEnabled ? (
    <MouseLayout flexDirection="row">{elements}</MouseLayout>
  ) : (
    <Text>{elements}</Text>
  )
}

function TabMouseTarget({
  id,
  label,
  active,
  scope,
  color,
  onChange,
}: {
  id: string
  label: string
  active: boolean
  scope: FocusScope
  color: string
  onChange: (id: string) => void
}) {
  const ref = useAutoMouseArea({
    scope,
    priority: 40,
    onClick: () => onChange(id),
  })

  return (
    <MouseLayout ref={ref}>
      <Text bold={active} color={color}>
        {label}
      </Text>
    </MouseLayout>
  )
}
