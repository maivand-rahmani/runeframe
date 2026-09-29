import { Box, Text } from 'ink'
import type { Boxes } from 'cli-boxes'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'

const BORDER_WIDTH = 2
const MIN_COLUMN_WIDTH = 1

type ColumnKey<T extends Record<string, unknown>> = Extract<keyof T, string>

export interface Column<T extends Record<string, unknown>> {
  key: ColumnKey<T>
  label: string
  width: number
  priority?: 'low'
}

export interface TableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  rows: T[]
  title?: string
  width?: number
}

function getVisibleColumns<T extends Record<string, unknown>>(
  columns: Column<T>[],
  width?: number,
): Column<T>[] {
  if (width == null || width >= LAYOUT.medium) {
    return columns
  }

  const highPriorityColumns = columns.filter(
    (column) => column.priority !== 'low',
  )

  if (highPriorityColumns.length > 0) {
    return highPriorityColumns
  }

  return columns.slice(0, 1)
}

function allocateColumnWidths<T extends Record<string, unknown>>(
  columns: Column<T>[],
  availableWidth?: number,
): number[] {
  if (columns.length === 0) {
    return []
  }

  const desiredWidths = columns.map((column) =>
    Math.max(column.width, MIN_COLUMN_WIDTH),
  )
  const totalDesiredWidth = desiredWidths.reduce(
    (sum, columnWidth) => sum + columnWidth,
    0,
  )

  if (availableWidth == null || availableWidth >= totalDesiredWidth) {
    return desiredWidths
  }

  const widths = desiredWidths.map((columnWidth) =>
    Math.max(
      MIN_COLUMN_WIDTH,
      Math.floor((columnWidth / totalDesiredWidth) * availableWidth),
    ),
  )

  let assignedWidth = widths.reduce((sum, columnWidth) => sum + columnWidth, 0)

  if (assignedWidth > availableWidth) {
    let overflow = assignedWidth - availableWidth

    while (overflow > 0) {
      let widestIndex = 0

      for (let index = 1; index < widths.length; index += 1) {
        if (widths[index] > widths[widestIndex]) {
          widestIndex = index
        }
      }

      if (widths[widestIndex] === MIN_COLUMN_WIDTH) {
        break
      }

      widths[widestIndex] -= 1
      overflow -= 1
    }

    assignedWidth = widths.reduce((sum, columnWidth) => sum + columnWidth, 0)
  }

  if (assignedWidth < availableWidth) {
    const rankedFractions = desiredWidths
      .map((columnWidth, index) => ({
        index,
        fraction:
          (columnWidth / totalDesiredWidth) * availableWidth -
          Math.floor((columnWidth / totalDesiredWidth) * availableWidth),
      }))
      .sort(
        (left, right) =>
          right.fraction - left.fraction || left.index - right.index,
      )

    let remainder = availableWidth - assignedWidth
    let cursor = 0

    while (remainder > 0) {
      widths[rankedFractions[cursor % rankedFractions.length].index] += 1
      remainder -= 1
      cursor += 1
    }
  }

  return widths
}

function formatCellValue(value: unknown): string {
  if (value == null) {
    return ''
  }

  return String(value)
}

export function Table<T extends Record<string, unknown>>({
  columns,
  rows,
  title,
  width,
}: TableProps<T>) {
  const theme = useTheme()
  const borderStyle = theme.borderStyles.table as keyof Boxes
  const visibleColumns = getVisibleColumns(columns, width)
  const gapWidth = Math.max(visibleColumns.length - 1, 0)
  const horizontalPadding = theme.spacing.xs * 2
  const availableCellWidth =
    width == null
      ? undefined
      : Math.max(
          width - BORDER_WIDTH - horizontalPadding - gapWidth,
          visibleColumns.length,
        )
  const columnWidths = allocateColumnWidths(visibleColumns, availableCellWidth)

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={theme.colors.border.default}
      flexDirection="column"
      paddingX={theme.spacing.xs}
      width={width}
    >
      {title != null && (
        <Box marginBottom={theme.spacing.xs}>
          <Text bold color={theme.colors.text.primary}>
            {title}
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Box flexDirection="row">
          {visibleColumns.map((column, index) => {
            const isLastColumn = index === visibleColumns.length - 1

            return (
              <Box
                key={`header-${String(column.key)}`}
                marginRight={isLastColumn ? 0 : 1}
                width={columnWidths[index]}
              >
                <Text bold color={theme.colors.text.secondary} wrap="truncate">
                  {column.label}
                </Text>
              </Box>
            )
          })}
        </Box>

        {rows.map((row, rowIndex) => (
          <Box key={`row-${rowIndex}`} flexDirection="row">
            {visibleColumns.map((column, columnIndex) => {
              const isLastColumn = columnIndex === visibleColumns.length - 1

              return (
                <Box
                  key={`cell-${rowIndex}-${String(column.key)}`}
                  marginRight={isLastColumn ? 0 : 1}
                  width={columnWidths[columnIndex]}
                >
                  <Text color={theme.colors.text.primary} wrap="truncate">
                    {formatCellValue(row[column.key])}
                  </Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
