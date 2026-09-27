import { useState, useCallback, useId, useRef, type ReactNode } from 'react'
import { Box, useWindowSize } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import { LAYOUT } from '../constants.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { useFocusZone } from '../interaction/FocusTreeProvider.js'
import { InputConsumptionResult } from '../types.js'

export interface AppShellProps {
  /** Optional top bar (app name, screen title, date) */
  topBar?: ReactNode

  /** Optional sidebar (screen navigation) — hidden below 80 cols */
  sidebar?: ReactNode

  /** Optional status bar (keyboard hints, mode indicator) */
  statusBar?: ReactNode

  /** Content area — renders current screen */
  children: ReactNode

  /** Override detected terminal width (for testing / responsive simulation) */
  columns?: number

  /** Sidebar layout mode: 'flow' (default) renders in flex flow, 'fixed' keeps it absolute */
  sidebarPosition?: 'flow' | 'fixed'

  /** Enable scrollable content area (requires sidebarPosition='fixed') */
  scrollContent?: boolean
}

const SIDEBAR_WIDTH = 20

export function AppShell({
  topBar,
  sidebar,
  statusBar,
  children,
  columns: columnsOverride,
  sidebarPosition = 'flow',
  scrollContent = false,
}: AppShellProps) {
  const { columns: detectedColumns } = useWindowSize()
  const columns = columnsOverride ?? detectedColumns ?? LAYOUT.medium
  const theme = useTheme()
  const contentZoneId = useId()
  const { ZoneProvider: ContentZoneProvider } = useFocusZone(contentZoneId, {
    scope: 'navigation',
    orientation: 'horizontal',
    order: 1,
  })

  const isNarrow = columns < LAYOUT.narrow
  const isWide = columns >= LAYOUT.medium
  const showSidebar = sidebar != null && !isNarrow
  const isFixedSidebar = sidebarPosition === 'fixed' && showSidebar
  const isScrollable = scrollContent && isFixedSidebar

  // Viewport scroll state
  const { rows } = useWindowSize()
  const viewportHeight = Math.max(1, Math.min(rows ?? 24, (rows ?? 24) - 3))
  const [scrollOffset, setScrollOffset] = useState(0)
  const scrollOffsetRef = useRef(scrollOffset)
  scrollOffsetRef.current = scrollOffset

  // Maximum scroll offset is capped at a reasonable ceiling for the MVP.
  // In a full implementation, this would be derived from measured content height.
  const MAX_SCROLL = 200
  const scrollStep = 1

  const scrollUp = useCallback(() => {
    setScrollOffset((prev) => Math.max(0, prev - scrollStep))
  }, [])

  const scrollDown = useCallback(() => {
    setScrollOffset((prev) => Math.min(MAX_SCROLL, prev + scrollStep))
  }, [])

  // Keyboard scroll controls — only active in scrollable mode
  // Registered at 'navigation' scope so deeper-scope widgets consume arrows first.
  useKeyHandler(
    (event) => {
      if (!isScrollable) return InputConsumptionResult.NotConsumed
      if (event.up) {
        scrollUp()
        return InputConsumptionResult.Consumed
      }
      if (event.down) {
        scrollDown()
        return InputConsumptionResult.Consumed
      }
      return InputConsumptionResult.NotConsumed
    },
    'navigation',
    { deps: [isScrollable, scrollUp, scrollDown], priority: 50 },
  )

  // Fixed sidebar + scrollable content uses absolute positioning for sidebar
  // and wraps content in a viewport-height container.
  if (isFixedSidebar) {
    return (
      <Box flexDirection="column">
        {topBar != null && (
          <Box marginBottom={theme.spacing.sm}>{topBar}</Box>
        )}

        <Box flexDirection="row" flexGrow={1}>
          {showSidebar && (
            <Box position="absolute" width={SIDEBAR_WIDTH} top={0} left={0}>
              {sidebar}
            </Box>
          )}
          <Box
            flexGrow={1}
            marginLeft={showSidebar ? SIDEBAR_WIDTH : 0}
            {...(isScrollable
              ? { height: viewportHeight, overflow: 'hidden' as const }
              : {})}
          >
            <ContentZoneProvider>
              {isScrollable ? (
                <Box marginTop={-scrollOffset}>{children}</Box>
              ) : (
                children
              )}
            </ContentZoneProvider>
          </Box>
        </Box>

        {statusBar != null && (
          <Box
            marginTop={theme.spacing.sm}
            borderStyle="single"
            borderColor={theme.colors.border.default}
          >
            {statusBar}
          </Box>
        )}
      </Box>
    )
  }

  // Legacy flex layout (default)
  return (
    <Box flexDirection="column">
      {topBar != null && (
        <Box marginBottom={theme.spacing.sm}>{topBar}</Box>
      )}

      <Box
        flexDirection={isWide ? 'row' : 'column'}
        gap={isWide ? theme.spacing.xs : 0}
      >
        {showSidebar && (
          <Box width={isWide ? SIDEBAR_WIDTH : undefined} flexShrink={0}>
            {sidebar}
          </Box>
        )}
        <Box flexGrow={1} flexShrink={isWide ? 1 : 0}>
          <ContentZoneProvider>{children}</ContentZoneProvider>
        </Box>
      </Box>

      {statusBar != null && (
        <Box
          marginTop={theme.spacing.sm}
          borderStyle="single"
          borderColor={theme.colors.border.default}
        >
          {statusBar}
        </Box>
      )}
    </Box>
  )
}
