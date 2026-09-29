import {
  useState,
  useCallback,
  useId,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import {
  useBoxMetrics,
  useWindowSize,
  type DOMElement,
} from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { useFocusZone } from '../../interaction/focus/FocusTreeProvider.js'
import { InputConsumptionResult } from '../../types.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { MouseScrollLayout } from '../../interaction/mouse/MouseScrollLayout.js'

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
  const [contentMetrics, setContentMetrics] = useState({
    height: 0,
    hasMeasured: false,
  })
  const viewportRef = useRef<DOMElement | null>(null)
  const viewportMetrics = useBoxMetrics(viewportRef)
  const maxScrollOffset =
    isScrollable &&
    contentMetrics.hasMeasured &&
    viewportMetrics.hasMeasured
      ? Math.max(0, contentMetrics.height - viewportMetrics.height)
      : 0
  const maxScrollOffsetRef = useRef(maxScrollOffset)
  maxScrollOffsetRef.current = maxScrollOffset
  const scrollStep = 1

  useLayoutEffect(() => {
    const clamped = Math.min(scrollOffsetRef.current, maxScrollOffset)
    if (clamped !== scrollOffsetRef.current) {
      scrollOffsetRef.current = clamped
      setScrollOffset(clamped)
    }
  }, [maxScrollOffset])

  const scrollBy = useCallback((delta: number): boolean => {
    const current = scrollOffsetRef.current
    const next = Math.max(
      0,
      Math.min(maxScrollOffsetRef.current, current + delta),
    )
    if (next === current) return false
    // Keep same-frame wheel reports from applying multiple stale state updates.
    scrollOffsetRef.current = next
    setScrollOffset(next)
    return true
  }, [])

  const scrollUp = useCallback(() => {
    scrollBy(-scrollStep)
  }, [scrollBy])

  const scrollDown = useCallback(() => {
    scrollBy(scrollStep)
  }, [scrollBy])

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
      <MouseLayout flexDirection="column">
        {topBar != null && (
          <MouseLayout marginBottom={theme.spacing.sm}>{topBar}</MouseLayout>
        )}

        <MouseLayout flexDirection="row" flexGrow={1}>
          {showSidebar && (
            <MouseLayout
              position="absolute"
              width={SIDEBAR_WIDTH}
              top={0}
              left={0}
            >
              {sidebar}
            </MouseLayout>
          )}
          {isScrollable ? (
            <MouseScrollLayout
              ref={viewportRef}
              flexGrow={1}
              marginLeft={showSidebar ? SIDEBAR_WIDTH : 0}
              height={viewportHeight}
              overflow="hidden"
              onWheel={(direction) =>
                scrollBy(direction === 'down' ? scrollStep : -scrollStep)
              }
            >
              <ContentZoneProvider>
                <MeasuredMouseLayout
                  marginTop={-scrollOffset}
                  onMetrics={setContentMetrics}
                >
                  {children}
                </MeasuredMouseLayout>
              </ContentZoneProvider>
            </MouseScrollLayout>
          ) : (
            <MouseLayout
              flexGrow={1}
              marginLeft={showSidebar ? SIDEBAR_WIDTH : 0}
            >
              <ContentZoneProvider>{children}</ContentZoneProvider>
            </MouseLayout>
          )}
        </MouseLayout>

        {statusBar != null && (
          <MouseLayout
            marginTop={theme.spacing.sm}
            borderStyle="single"
            borderColor={theme.colors.border.default}
          >
            {statusBar}
          </MouseLayout>
        )}
      </MouseLayout>
    )
  }

  // Legacy flex layout (default)
  return (
    <MouseLayout flexDirection="column">
      {topBar != null && (
        <MouseLayout marginBottom={theme.spacing.sm}>{topBar}</MouseLayout>
      )}

      <MouseLayout
        flexDirection={isWide ? 'row' : 'column'}
        gap={isWide ? theme.spacing.xs : 0}
      >
        {showSidebar && (
          <MouseLayout width={isWide ? SIDEBAR_WIDTH : undefined} flexShrink={0}>
            {sidebar}
          </MouseLayout>
        )}
        <MouseLayout flexGrow={1} flexShrink={isWide ? 1 : 0}>
          <ContentZoneProvider>{children}</ContentZoneProvider>
        </MouseLayout>
      </MouseLayout>

      {statusBar != null && (
        <MouseLayout
          marginTop={theme.spacing.sm}
          borderStyle="single"
          borderColor={theme.colors.border.default}
        >
          {statusBar}
        </MouseLayout>
      )}
    </MouseLayout>
  )
}

function MeasuredMouseLayout({
  children,
  marginTop,
  onMetrics,
}: {
  children: ReactNode
  marginTop: number
  onMetrics: (metrics: { height: number; hasMeasured: boolean }) => void
}) {
  const ref = useRef<DOMElement | null>(null)
  const metrics = useBoxMetrics(ref)

  useLayoutEffect(() => {
    onMetrics({ height: metrics.height, hasMeasured: metrics.hasMeasured })
  }, [metrics.height, metrics.hasMeasured, onMetrics])

  // Avoid cross-axis stretching to the viewport: the viewport clips this box,
  // while its natural height supplies the full content extent for clamping.
  return (
    <MouseLayout
      ref={ref}
      alignSelf="flex-start"
      marginTop={marginTop}
    >
      {children}
    </MouseLayout>
  )
}
