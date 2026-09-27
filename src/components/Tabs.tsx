import { Text } from 'ink'
import { useRef, type ReactElement } from 'react'
import { useTheme } from '../design-system/ThemeProvider.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import type { FocusScope } from '../types.js'

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
  const columns = process.stdout.columns ?? 80

  // Use refs so the input handler always reads the latest values
  // without needing to re-register (which creates a gap between cleanup and setup).
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

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

    elements.push(
      <Text
        key={`tab-${tab.id}`}
        bold={isActive}
        color={isActive ? colors.focus.active : colors.text.secondary}
      >
        {truncateLabel(tab.label, perTabWidth)}
      </Text>,
    )
  }

  return <Text>{elements}</Text>
}
