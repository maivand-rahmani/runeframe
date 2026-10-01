import { useState, useEffect, useRef, type ReactElement } from 'react'
import { Box, Text, type BoxProps } from 'ink'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../../components/primitives/themeOverrides.js'
import type { ActionRegistry, ActionMatch } from '../actions/ActionRegistry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

export interface CommandPaletteProps {
  registry: ActionRegistry
  onClose: () => void
}

export function CommandPalette({ registry, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const results = registry.search(query)
  const theme = useTheme()
  const { colors } = theme
  const overrides = componentOverrides(theme, 'commandPalette')
  const borderStyle = (overrides?.borderStyle ??
    theme.layout?.commandPaletteBorderStyle ??
    'round') as BoxProps['borderStyle']
  const borderColor = overrides?.colors?.border ?? colors.border.default
  const promptColor = overrides?.colors?.prompt ?? colors.focus.active
  const selectedColor = overrides?.colors?.selected ?? colors.focus.active
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled = mouseGeometry != null && mouseRegistry != null

  useEffect(() => {
    setSelectedIndex(0)
    setHoveredIndex(null)
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
      borderStyle={borderStyle}
      borderColor={borderColor}
    >
      <Box>
        <Text bold color={promptColor}>
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
          hoveredIndex,
          query,
          selectedColor,
          autoMouseEnabled,
          setSelectedIndex,
          (index, hovered) => setHoveredIndex(hovered ? index : null),
        )}
      </MouseLayout>
    </MouseLayout>
  )
}

function renderResults(
  results: ActionMatch[],
  selectedIndex: number,
  hoveredIndex: number | null,
  query: string,
  selectedColor: string,
  autoMouseEnabled: boolean,
  onSelect: (index: number) => void,
  onHoverChange: (index: number, hovered: boolean) => void,
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
    const isHovered = resultIndex === hoveredIndex
    const rowKey = `${match.action.id}:${resultIndex}`
    const rowContents = (
      <Text
        color={isSelected ? selectedColor : undefined}
        bold={isSelected}
        underline={isHovered}
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
          onEnter={() => onHoverChange(resultIndex, true)}
          onLeave={() => onHoverChange(resultIndex, false)}
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
  onEnter,
  onLeave,
}: {
  children: ReactElement
  onClick: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  const ref = useAutoMouseArea({
    scope: 'command',
    priority: 80,
    onClick,
    onEnter,
    onLeave,
  })
  return <Box ref={ref}>{children}</Box>
}
