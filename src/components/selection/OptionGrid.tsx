import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import {
  componentLayoutNumber,
  componentOverrides,
} from '../primitives/themeOverrides.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useShellSuspension } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { useRegisterActions } from '../../commands/actions/ScopedActionRegistryProvider.js'
import { InputConsumptionResult } from '../../types.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'

// ── Data Types ──

export interface OptionGridOption {
  value: string
  label: string
  disabled?: boolean
}

export interface OptionGridProps {
  options: OptionGridOption[]
  onSelect: (value: string) => void
  columns?: number
}

// ── Component ──

export function OptionGrid({
  options,
  onSelect,
  columns = 2,
}: OptionGridProps) {
  const { suspend, restore } = useShellSuspension()
  const mouseGeometry = useMouseGeometry()
  const mouseRegistry = useMouseRegistry()
  const autoMouseEnabled = mouseGeometry != null && mouseRegistry != null
  const onSelectRef = useRef(onSelect)
  const optionsRef = useRef(options)
  onSelectRef.current = onSelect
  optionsRef.current = options
  const safeColumns = Math.max(1, columns)

  const [focusIndex, setFocusIndex] = useState(() => {
    const first = options.findIndex((opt) => !opt.disabled)
    return first >= 0 ? first : 0
  })

  const focusIndexRef = useRef(focusIndex)
  focusIndexRef.current = focusIndex

  const handleMouseSelect = (renderedOption: OptionGridOption, index: number) => {
    const option = optionsRef.current[index]
    if (!option || option !== renderedOption || option.disabled) return

    focusIndexRef.current = index
    setFocusIndex(index)
    onSelectRef.current(option.value)
  }

  // Find next non-disabled index
  const findNextEnabled = useCallback(
    (start: number, direction: 1 | -1): number => {
      if (options.length === 0) return start
      let idx = start
      for (let i = 0; i < options.length; i++) {
        idx = (idx + direction + options.length) % options.length
        if (!options[idx].disabled) return idx
      }
      return start
    },
    [options],
  )

  // Grid-aware navigation helpers
  const navigateDown = useCallback(() => {
    setFocusIndex((prev) => {
      const next = prev + safeColumns
      if (next < options.length && !options[next].disabled) return next
      // Try the next enabled item below, or wrap
      const candidate = findNextEnabled(prev, 1)
      return candidate
    })
  }, [options, safeColumns, findNextEnabled])

  const navigateUp = useCallback(() => {
    setFocusIndex((prev) => {
      const next = prev - safeColumns
      if (next >= 0 && !options[next].disabled) return next
      const candidate = findNextEnabled(prev, -1)
      return candidate
    })
  }, [options, safeColumns, findNextEnabled])

  const navigateRight = useCallback(() => {
    setFocusIndex((prev) => {
      if (prev + 1 < options.length && !options[prev + 1].disabled) {
        return prev + 1
      }
      return findNextEnabled(prev, 1)
    })
  }, [options, findNextEnabled])

  const navigateLeft = useCallback(() => {
    setFocusIndex((prev) => {
      if (prev - 1 >= 0 && !options[prev - 1].disabled) {
        return prev - 1
      }
      return findNextEnabled(prev, -1)
    })
  }, [options, findNextEnabled])

  // Clamp when items change
  useEffect(() => {
    setFocusIndex((prev) => {
      if (prev >= options.length) {
        return findNextEnabled(options.length - 1, -1)
      }
      if (options[prev]?.disabled) {
        return findNextEnabled(prev, 1)
      }
      return prev
    })
  }, [options, findNextEnabled])

  // Suspend shell hotkeys
  useEffect(() => {
    suspend()
    return () => restore()
  }, [suspend, restore])

  // Keyboard handler
  useKeyHandler(
    (event) => {
      if (event.down) {
        navigateDown()
        return InputConsumptionResult.Consumed
      }

      if (event.up) {
        navigateUp()
        return InputConsumptionResult.Consumed
      }

      if (event.right) {
        navigateRight()
        return InputConsumptionResult.Consumed
      }

      if (event.left) {
        navigateLeft()
        return InputConsumptionResult.Consumed
      }

      if (event.enter) {
        const current = focusIndexRef.current
        const opt = options[current]
        if (opt && !opt.disabled) {
          onSelectRef.current(opt.value)
        }
        return InputConsumptionResult.Consumed
      }

      return InputConsumptionResult.NotConsumed
    },
    'list',
    { deps: [options, navigateDown, navigateUp, navigateRight, navigateLeft] },
  )

  // Register actions
  useRegisterActions([
    {
      id: 'option-grid-up',
      label: 'Move up',
      category: 'input',
      handler: navigateUp,
      keys: ['up'],
      scope: 'list',
    },
    {
      id: 'option-grid-down',
      label: 'Move down',
      category: 'input',
      handler: navigateDown,
      keys: ['down'],
      scope: 'list',
    },
    {
      id: 'option-grid-left',
      label: 'Move left',
      category: 'input',
      handler: navigateLeft,
      keys: ['left'],
      scope: 'list',
    },
    {
      id: 'option-grid-right',
      label: 'Move right',
      category: 'input',
      handler: navigateRight,
      keys: ['right'],
      scope: 'list',
    },
    {
      id: 'option-grid-select',
      label: 'Select option',
      category: 'input',
      handler: () => {
        const current = focusIndexRef.current
        const opt = options[current]
        if (opt && !opt.disabled) onSelectRef.current(opt.value)
      },
      keys: ['enter'],
      scope: 'list',
    },
  ])

  // ── Render ──

  if (options.length === 0) {
    return <Text dimColor>No options</Text>
  }

  // Build rows
  const rows: OptionGridOption[][] = []
  for (let i = 0; i < options.length; i += safeColumns) {
    rows.push(options.slice(i, i + safeColumns))
  }

  return (
    <MouseLayout flexDirection="column">
      {rows.map((row, rowIdx) => (
        <MouseLayout key={rowIdx} flexDirection="row">
          {row.map((opt, colIdx) => {
            const globalIdx = rowIdx * safeColumns + colIdx
            const isFocused = globalIdx === focusIndex

            const rowKey = `${opt.value}:${globalIdx}`
            return (
              <OptionGridCell
                key={rowKey}
                option={opt}
                focused={isFocused}
                autoMouseEnabled={autoMouseEnabled}
                onClick={() => handleMouseSelect(opt, globalIdx)}
              />
            )
          })}
        </MouseLayout>
      ))}
    </MouseLayout>
  )
}

function OptionGridCell({
  option,
  focused,
  autoMouseEnabled,
  onClick,
}: {
  option: OptionGridOption
  focused: boolean
  autoMouseEnabled: boolean
  onClick: () => void
}) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'optionGrid')
  const gap = componentLayoutNumber(
    theme,
    'optionGrid',
    'columnGap',
    theme.spacing.sm,
  )
  const mutedColor = overrides?.colors?.disabled ?? theme.colors.text.muted
  const activeColor = overrides?.colors?.focused ?? theme.colors.focus.active
  const selectedColor = overrides?.colors?.hovered ?? theme.colors.focus.selected
  const primaryColor = overrides?.colors?.label ?? theme.colors.text.primary
  const [hovered, setHovered] = useState(false)
  const disabled = Boolean(option.disabled)
  const content = (
    <Text
      color={
        disabled
          ? mutedColor
          : focused
            ? activeColor
            : hovered
              ? selectedColor
              : primaryColor
      }
      bold={focused && !disabled}
      dimColor={disabled}
      underline={hovered && !disabled}
    >
      {option.label}
    </Text>
  )

  if (autoMouseEnabled) {
    return (
      <OptionGridAutoCell
        gap={gap}
        disabled={disabled}
        onClick={onClick}
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
      >
        {content}
      </OptionGridAutoCell>
    )
  }

  return <Box marginRight={gap}>{content}</Box>
}

function OptionGridAutoCell({
  children,
  gap,
  disabled,
  onClick,
  onEnter,
  onLeave,
}: {
  children: ReactNode
  gap: number
  disabled: boolean
  onClick: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  const ref = useAutoMouseArea({ disabled, onClick, onEnter, onLeave })
  return (
    <Box ref={ref} marginRight={gap}>
      {children}
    </Box>
  )
}
