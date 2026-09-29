import { useState, useEffect, useRef, type ReactElement } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useTheme } from '../design-system/ThemeProvider.js'
import type { ActionRegistry, ActionMatch } from '../commands/ActionRegistry.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/MouseProvider.js'

export interface CommandPaletteProps {
  registry: ActionRegistry
  onClose: () => void
}

export function CommandPalette({ registry, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const results = registry.search(query)
  const { colors } = useTheme()
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled = mouseGeometry != null && mouseRegistry != null

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const ref = useRef({
    results,
    selectedIndex,
    setSelectedIndex,
    query,
    setQuery,
    onClose,
  })
  ref.current = {
    results,
    selectedIndex,
    setSelectedIndex,
    query,
    setQuery,
    onClose,
  }

  useKeyHandler(
    (event) => {
      const h = ref.current

      if (event.escape) {
        h.onClose()
        return true
      }

      if (event.enter && h.results[h.selectedIndex]) {
        h.results[h.selectedIndex].action.handler()
        h.onClose()
        return true
      }

      if (event.down) {
        h.setSelectedIndex((prev: number) =>
          Math.min(prev + 1, h.results.length - 1),
        )
        return true
      }

      if (event.up) {
        h.setSelectedIndex((prev: number) => Math.max(prev - 1, 0))
        return true
      }

      if (event.backspace) {
        h.setQuery((prev: string) => prev.slice(0, -1))
        return true
      }

      if (event.isPrintable) {
        h.setQuery((prev: string) => prev + event.text)
        return true
      }
    },
    'command',
    { priority: 80 },
  )

  return (
    <MouseLayout
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.border.default}
    >
      <Box>
        <Text bold color={colors.focus.active}>
          {'>'}
        </Text>
        <Text>{' '}</Text>
        <Text>{query}</Text>
        <Text dimColor>|</Text>
      </Box>
      <MouseLayout flexDirection="column">
        {renderResults(
          results,
          selectedIndex,
          query,
          colors,
          autoMouseEnabled,
          setSelectedIndex,
        )}
      </MouseLayout>
    </MouseLayout>
  )
}

function renderResults(
  results: ActionMatch[],
  selectedIndex: number,
  query: string,
  colors: ReturnType<typeof useTheme>['colors'],
  autoMouseEnabled: boolean,
  onSelect: (index: number) => void,
): ReactElement[] {
  const elements: ReactElement[] = []
  let currentCategory = ''
  let flatIndex = 0

  for (const match of results) {
    if (match.action.category !== currentCategory) {
      currentCategory = match.action.category
      elements.push(
        <Text key={`cat-${currentCategory}`} bold dimColor>
          {currentCategory.toUpperCase()}
        </Text>,
      )
    }

    const resultIndex = flatIndex
    const isSelected = resultIndex === selectedIndex
    const rowKey = `${match.action.id}:${resultIndex}`
    const rowContents = (
      <Text
        color={isSelected ? colors.focus.active : undefined}
        bold={isSelected}
      >
        {isSelected ? '> ' : '  '}
        {match.action.label}
      </Text>
    )
    elements.push(
      autoMouseEnabled ? (
        <CommandPaletteAutoRow
          key={rowKey}
          onClick={() => onSelect(resultIndex)}
        >
          {rowContents}
        </CommandPaletteAutoRow>
      ) : (
        <Box key={match.action.id}>{rowContents}</Box>
      ),
    )
    flatIndex++
  }

  if (results.length === 0) {
    elements.push(
      <Text key="no-results" dimColor>
        {query
          ? 'No matching commands found'
          : 'Type a command or search term'}
      </Text>,
    )
  }

  return elements
}

function CommandPaletteAutoRow({
  children,
  onClick,
}: {
  children: ReactElement
  onClick: () => void
}) {
  const ref = useAutoMouseArea({
    scope: 'command',
    priority: 80,
    onClick,
  })
  return <Box ref={ref}>{children}</Box>
}
