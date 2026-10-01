import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Box, Text, useBoxMetrics, useWindowSize } from 'ink'
import type { DOMElement } from 'ink'
import {
  ActionRegistry,
  AppShell,
  Breadcrumbs,
  Button,
  ChoicePrompt,
  detectCollisions,
  EventTracer,
  FrameworkProvider,
  HotkeyHintBar,
  KeyboardDebugInspector,
  List,
  ListSelect,
  LAYOUT,
  ModalDialog,
  MouseArea,
  MouseLayout,
  NumberInput,
  NodeProcessRunner,
  ProcessOutputPanel,
  RadioList,
  ScreenOutlet,
  ScreenRegistry,
  SearchInput,
  SelectableList,
  Sidebar,
  StatusBar,
  StepFlow,
  Tabs,
  TextInput,
  TopBar,
  useActiveActions,
  useAsyncSession,
  useFocusGroup,
  useFocusZone,
  useFocusable,
  useKeyBinding,
  useKeyHandler,
  useKeyboardScope,
  useModal,
  useNavigation,
  useRegisterActions,
  useTheme,
  useToast,
  InputConsumptionResult,
  type Action,
  type FrameworkProviderProps,
  type MouseDragEvent,
  type MousePointerEvent,
  type Step,
} from 'runeframe'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'

type RouteId = 'overview' | 'controls' | 'workflow' | 'runtime' | 'interactions'
type ThemeMode = 'dark' | 'light'

interface InteractionTabState {
  activeTab: string
  setActiveTab: (id: string) => void
  compactMouse: boolean
  shellScrollable: boolean
  brandHovered: boolean
  pointerMessage: string
  dragMessage: string
}

const INITIAL_POINTER_MESSAGE = 'Move over the app name above to test hover.'

const InteractionTabContext = createContext<InteractionTabState>({
  activeTab: 'focus',
  setActiveTab: () => {},
  compactMouse: false,
  shellScrollable: false,
  brandHovered: false,
  pointerMessage: INITIAL_POINTER_MESSAGE,
  dragMessage: '',
})

const SHOWCASE_BRAND = 'RUNEFRAME / FEATURE LAB'
const SHOWCASE_COMPACT_BRAND = 'RUNEFRAME'

interface CommandDispatch {
  navigate: (screenId: RouteId) => void
  back: () => void
  reset: () => void
  openHelp: () => void
  openPalette: () => void
  toggleTheme: () => void
  showToast: () => void
}

// ActionRegistry owns searchable command metadata; handlers bridge into the
// live shell without reaching into any Runeframe implementation detail.
const commandDispatch: CommandDispatch = {
  navigate: () => {},
  back: () => {},
  reset: () => {},
  openHelp: () => {},
  openPalette: () => {},
  toggleTheme: () => {},
  showToast: () => {},
}

const shellActions: Action[] = [
  {
    id: 'open-overview',
    label: 'Open overview',
    description: 'Replace the current route with the feature map',
    category: 'navigation',
    keys: ['0'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.reset(),
  },
  {
    id: 'open-controls',
    label: 'Open controls',
    category: 'navigation',
    keys: ['1'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.navigate('controls'),
  },
  {
    id: 'open-workflow',
    label: 'Open workflow',
    category: 'navigation',
    keys: ['2'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.navigate('workflow'),
  },
  {
    id: 'open-process-session',
    label: 'Open process session',
    category: 'navigation',
    keys: ['3'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.navigate('runtime'),
  },
  {
    id: 'open-interaction-lab',
    label: 'Open interaction lab',
    category: 'navigation',
    keys: ['4'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.navigate('interactions'),
  },
  {
    id: 'back-one-route',
    label: 'Back one route',
    category: 'navigation',
    keys: ['b'],
    scope: 'navigation',
    group: 'navigate',
    handler: () => commandDispatch.back(),
  },
  {
    id: 'open-help',
    label: 'Open help',
    category: 'system',
    keys: ['?'],
    scope: 'navigation',
    group: 'shell',
    handler: () => commandDispatch.openHelp(),
  },
  {
    id: 'open-command-palette',
    label: 'Open command palette',
    category: 'system',
    keys: ['ctrl+p'],
    scope: 'navigation',
    group: 'shell',
    handler: () => commandDispatch.openPalette(),
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    category: 'system',
    keys: ['t'],
    scope: 'navigation',
    group: 'shell',
    handler: () => commandDispatch.toggleTheme(),
  },
  {
    id: 'show-toast',
    label: 'Show sample toast',
    category: 'system',
    keys: ['f'],
    scope: 'navigation',
    group: 'shell',
    handler: () => commandDispatch.showToast(),
  },
]

const commandRegistry = new ActionRegistry()
for (const action of shellActions) {
  if (action.id !== 'open-command-palette') commandRegistry.register(action)
}

const screenRegistry = new ScreenRegistry()
screenRegistry.register({
  id: 'overview',
  title: 'Overview',
  category: 'main',
  component: () => <OverviewScreen />,
})
screenRegistry.register({
  id: 'controls',
  title: 'Controls',
  category: 'main',
  component: () => <ControlsScreen />,
})
screenRegistry.register({
  id: 'workflow',
  title: 'Workflow',
  category: 'main',
  component: () => <WorkflowScreen />,
})
screenRegistry.register({
  id: 'runtime',
  title: 'Process session',
  category: 'system',
  component: () => <RuntimeScreen />,
})
screenRegistry.register({
  id: 'interactions',
  title: 'Interaction lab',
  category: 'system',
  component: () => <InteractionScreen />,
})
screenRegistry.register({
  id: 'help-modal',
  title: 'Help',
  category: 'system',
  component: ({ closeModal }) => (
    <HelpModal onClose={closeModal ?? (() => {})} />
  ),
})

const sidebarItems = [
  { id: 'overview', label: 'Overview', description: 'Start here', category: 'main' },
  { id: 'controls', label: 'Controls', description: 'Inputs + selection', category: 'main' },
  { id: 'workflow', label: 'Workflow', description: 'Prompt + steps', category: 'main' },
  { id: 'runtime', label: 'Process', description: 'Real child output', category: 'system' },
  { id: 'interactions', label: 'Input lab', description: 'Focus + keys + mouse', category: 'system' },
]

/**
 * Optional mouse routing diagnostics. Typed through the public
 * `FrameworkProviderProps` surface so this app does not need a new barrel
 * export; `undefined` is a complete no-op.
 */
export type MouseDiagnosticsHandler = NonNullable<
  FrameworkProviderProps['mouseDiagnostics']
>

export interface ShowcaseAppProps {
  /**
   * Forwarded to `FrameworkProvider` as mouse routing diagnostics. Off by
   * default; tests pass a sink to observe routing decisions.
   */
  mouseDiagnostics?: MouseDiagnosticsHandler
  /**
   * Forwarded to `FrameworkProvider` as the normalized mouse event source.
   * When provided, `MouseProvider` routes that channel and disables the
   * legacy post-Ink SGR interceptor, so a report seen on both transports is
   * dispatched exactly once. Supplied by the Windows default lane.
   */
  mouseEventSource?: FrameworkProviderProps['mouseEventSource']
}

export function ShowcaseApp({
  mouseDiagnostics,
  mouseEventSource,
}: ShowcaseAppProps = {}) {
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const toggleTheme = useCallback(() => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
      <FrameworkProvider
        registry={screenRegistry}
        defaultScreen="overview"
        themeMode={themeMode}
        mouseDiagnostics={mouseDiagnostics}
        mouseEventSource={mouseEventSource}
      >
        <ShowcaseFrame themeMode={themeMode} onToggleTheme={toggleTheme} />
      </FrameworkProvider>
    </MouseLayout>
  )
}

function ShowcaseFrame({
  themeMode,
  onToggleTheme,
}: {
  themeMode: ThemeMode
  onToggleTheme: () => void
}) {
  const { columns: detectedColumns, rows: detectedRows } = useWindowSize()
  const columns = detectedColumns ?? process.stdout.columns ?? 80
  const rows = detectedRows ?? process.stdout.rows ?? 24
  const compactHeight = rows < 22
  const {
    currentScreen,
    currentScreenId,
    canGoBack,
    breadcrumbs,
    push,
    pop,
    popToRoot,
    replace,
  } = useNavigation()
  const { openModal } = useModal()
  const { toast, visibleRows } = useToast()
  const theme = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [interactionTab, setInteractionTab] = useState('focus')
  const [brandHovered, setBrandHovered] = useState(false)
  const [pointerMessage, setPointerMessage] = useState(INITIAL_POINTER_MESSAGE)
  const [dragMessage, setDragMessage] = useState('')
  const previousVisibleRows = useRef(visibleRows)
  useEffect(() => {
    if (previousVisibleRows.current === visibleRows) return
    previousVisibleRows.current = visibleRows
    // A toast shifts the measured app name, but no pointer motion may arrive
    // to clear its previous hover target. Reset the demo cue with that shift.
    setBrandHovered(false)
    setPointerMessage(INITIAL_POINTER_MESSAGE)
    setDragMessage('')
  }, [visibleRows])
  const compactLayout = compactHeight || columns < LAYOUT.narrow
  const compactMouse =
    currentScreenId === 'interactions' &&
    interactionTab === 'mouse' &&
    compactHeight
  // Keep the content viewport scrollable at every terminal size. In compact
  // layouts this keeps route navigation and actions reachable above the route
  // content instead of letting a tall demo push them past the terminal edge.
  const shellScrollable = true
  const back = useCallback(() => {
    if (canGoBack) pop()
    else toast('info', 'Already at the start of this route.')
  }, [canGoBack, pop, toast])
  const reset = useCallback(() => replace('overview'), [replace])
  const goHome = useCallback(() => {
    if (canGoBack) popToRoot()
    else reset()
  }, [canGoBack, popToRoot, reset])
  const navigateTo = useCallback(
    (screenId: RouteId) => {
      if (screenId !== currentScreenId) push(screenId)
    },
    [currentScreenId, push],
  )
  const navigateToBreadcrumb = useCallback(
    (screenId: string) => {
      const currentIndex = breadcrumbs.length - 1
      const targetIndex = breadcrumbs
        .slice(0, currentIndex)
        .map((entry) => entry.screenId)
        .lastIndexOf(screenId)
      if (targetIndex < 0) return
      if (targetIndex === 0) {
        popToRoot()
        return
      }
      for (let index = targetIndex; index < currentIndex; index++) pop()
    },
    [breadcrumbs, pop, popToRoot],
  )
  const showToast = useCallback(
    () => toast('success', 'Toast provider is live.'),
    [toast],
  )
  const showHelp = useCallback(() => openModal('help-modal'), [openModal])
  const showPalette = useCallback(() => setPaletteOpen(true), [])

  commandDispatch.navigate = (screenId) => push(screenId)
  commandDispatch.back = back
  commandDispatch.reset = reset
  commandDispatch.openHelp = showHelp
  commandDispatch.openPalette = showPalette
  commandDispatch.toggleTheme = onToggleTheme
  commandDispatch.showToast = showToast

  useRegisterActions(shellActions)

  useKeyBinding('p', showPalette, 'navigation', {
    modifiers: { ctrl: true },
  })
  useKeyBinding('?', showHelp, 'navigation')
  useKeyBinding('t', onToggleTheme, 'navigation')
  useKeyBinding('f', showToast, 'navigation')
  useKeyBinding('0', reset, 'navigation')
  useKeyBinding('1', () => push('controls'), 'navigation')
  useKeyBinding('2', () => push('workflow'), 'navigation')
  useKeyBinding('3', () => push('runtime'), 'navigation')
  useKeyBinding('4', () => push('interactions'), 'navigation')
  useKeyBinding('b', back, 'navigation')

  const sidebar = (
    <Sidebar
      items={sidebarItems}
      categoryOrder={['main', 'system']}
      sectionTitles={{ main: 'FIELD GUIDE', system: 'LIVE SYSTEMS' }}
      screenOrderByCategory={{
        main: ['overview', 'controls', 'workflow'],
        system: ['runtime', 'interactions'],
      }}
    />
  )

  const status = (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <StatusBar
        mode={`${themeMode.toUpperCase()} / ${currentScreenId.toUpperCase()}`}
        columns={columns}
      />
      <Box flexDirection="row" gap={2}>
        <LiveActionCount />
        <HotkeyHintBar scope="navigation" maxHints={columns < 64 ? 1 : 2} />
      </Box>
    </Box>
  )

  const topBar = columns >= SHOWCASE_COMPACT_BRAND.length ? (
    <MouseDemoTopBar
      screenTitle={currentScreen.title}
      columns={columns}
      hovered={brandHovered}
      showActions={!compactLayout}
      themeMode={themeMode}
      onBack={back}
      canGoBack={canGoBack}
      onHome={goHome}
      onHelp={showHelp}
      onCommands={showPalette}
      onToggleTheme={onToggleTheme}
      onEnter={(event) => {
        setBrandHovered(true)
        setDragMessage('')
        setPointerMessage(`Pointer entered at ${event.x}, ${event.y}.`)
      }}
      onLeave={(event) => {
        setBrandHovered(false)
        setDragMessage('')
        setPointerMessage(
          event.y < visibleRows
            ? INITIAL_POINTER_MESSAGE
            : `Pointer left at ${event.x}, ${event.y}.`,
        )
      }}
      onMove={(event) => {
        setBrandHovered(true)
        setDragMessage('')
        setPointerMessage(`Pointer over app name at ${event.x}, ${event.y}.`)
      }}
      onDragStart={(event) => {
        setDragMessage(`Drag started at ${event.startX}, ${event.startY}.`)
      }}
      onDragMove={(event) => {
        setDragMessage(
          `Dragging ${event.startX}, ${event.startY} → ${event.x}, ${event.y}.`,
        )
      }}
      onDragEnd={(event) => {
        setDragMessage(
          `Drag ended at ${event.x}, ${event.y} from ${event.startX}, ${event.startY}.`,
        )
      }}
      onDragCancel={(event) => {
        setDragMessage(
          `Drag cancelled at ${event.x}, ${event.y} from ${event.startX}, ${event.startY}.`,
        )
      }}
    />
  ) : compactLayout ? (
    <TopBar
      appName="RUNEFRAME / FEATURE LAB"
      screenTitle={currentScreen.title}
      columns={columns}
    />
  ) : (
    <ShowcaseTopBar
      columns={columns}
      screenTitle={currentScreen.title}
      themeMode={themeMode}
      onBack={back}
      canGoBack={canGoBack}
      onHome={goHome}
      onHelp={showHelp}
      onCommands={showPalette}
      onToggleTheme={onToggleTheme}
    />
  )

  // The outer anchored MouseLayout encloses FrameworkProvider as well as this
  // shell, so routes and modal overlays share the same measured terminal space.
  return (
    <MouseLayout
      flexDirection="column"
      width={columns}
      backgroundColor={theme.colors.surface.base}
    >
      <AppShell
        columns={columns}
        sidebar={compactHeight ? undefined : sidebar}
        sidebarPosition="fixed"
        scrollContent={shellScrollable}
        topBar={topBar}
        statusBar={rows < 12 || compactMouse ? undefined : status}
      >
        <MouseLayout flexDirection="column" paddingX={1}>
          {compactLayout && (
            <MouseLayout marginBottom={1} flexDirection="column">
              <CompactRouteNavigation
                currentScreenId={currentScreenId}
                onNavigate={navigateTo}
              />
              <ShellActionButtons
                themeMode={themeMode}
                onBack={back}
                canGoBack={canGoBack}
                onHome={goHome}
                onHelp={showHelp}
                onCommands={showPalette}
                onToggleTheme={onToggleTheme}
              />
            </MouseLayout>
          )}
          <MouseLayout marginBottom={1} flexDirection="row" flexWrap="wrap" gap={1}>
            <Text color={theme.colors.text.muted}>PATH </Text>
            <Breadcrumbs maxItems={3} onSelect={navigateToBreadcrumb} />
            {!compactLayout && (
              <Button
                variant="ghost"
                disabled={!canGoBack}
                onActivate={back}
              >
                Back
              </Button>
            )}
          </MouseLayout>
          <InteractionTabContext.Provider
            value={{
              activeTab: interactionTab,
              setActiveTab: setInteractionTab,
              compactMouse,
              shellScrollable,
              brandHovered,
              pointerMessage,
              dragMessage,
            }}
          >
            {paletteOpen ? (
              <ShowcaseCommandPalette
                registry={commandRegistry}
                onClose={() => setPaletteOpen(false)}
              />
            ) : (
              <ScreenTransition type="fade" duration={90}>
                <ScreenOutlet />
              </ScreenTransition>
            )}
          </InteractionTabContext.Provider>
          {!compactHeight && !compactMouse && (
            <MouseLayout flexDirection="column">
              <Text dimColor>
                [ctrl+p] commands  [t] theme  [?] help  [0] replace route
              </Text>
              <Text
                color={
                  brandHovered
                    ? theme.colors.status.info
                    : theme.colors.text.muted
                }
              >
                {brandHovered
                  ? dragMessage || pointerMessage
                  : 'Mouse: click controls · hover the app name · keyboard still works'}
              </Text>
            </MouseLayout>
          )}
        </MouseLayout>
      </AppShell>
    </MouseLayout>
  )
}

function LiveActionCount() {
  const actions = useActiveActions()
  return <Text dimColor>{actions.length} actions</Text>
}

function MouseDemoTopBar({
  screenTitle,
  columns,
  hovered,
  showActions,
  themeMode,
  onBack,
  canGoBack,
  onHome,
  onHelp,
  onCommands,
  onToggleTheme,
  onEnter,
  onLeave,
  onMove,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  screenTitle: string
  columns: number
  hovered: boolean
  showActions: boolean
  themeMode: ThemeMode
  onBack: () => void
  canGoBack: boolean
  onHome: () => void
  onHelp: () => void
  onCommands: () => void
  onToggleTheme: () => void
  onEnter: (event: MousePointerEvent) => void
  onLeave: (event: MousePointerEvent) => void
  onMove: (event: MousePointerEvent) => void
  onDragStart: (event: MouseDragEvent) => void
  onDragMove: (event: MouseDragEvent) => void
  onDragEnd: (event: MouseDragEvent) => void
  onDragCancel: (event: MouseDragEvent) => void
}) {
  const theme = useTheme()
  const { visibleRows } = useToast()
  const brandText =
    columns < SHOWCASE_BRAND.length ? SHOWCASE_COMPACT_BRAND : SHOWCASE_BRAND
  const brandRef = useRef<DOMElement | null>(null)
  const metrics = useBoxMetrics(brandRef)
  // The measured top is relative to the shell. ToastProvider renders rows
  // above that shell, so translate the target into the physical terminal space.
  const bounds = {
    x: Math.round(metrics.left),
    y: Math.round(metrics.top) + visibleRows,
    width: metrics.hasMeasured ? Math.round(metrics.width) : 0,
    height: metrics.hasMeasured ? Math.round(metrics.height) : 0,
  }

  return (
    <MouseLayout
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
    >
      <MouseLayout flexDirection="row" flexShrink={0} gap={1}>
        <MouseLayout ref={brandRef} flexShrink={0}>
          <MouseArea
            bounds={bounds}
            scope="navigation"
            onEnter={onEnter}
            onLeave={onLeave}
            onMove={onMove}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <Text
              bold
              color={hovered ? theme.colors.text.inverse : theme.colors.text.primary}
              backgroundColor={hovered ? theme.colors.status.info : undefined}
              underline={hovered}
            >
              {brandText}
            </Text>
          </MouseArea>
        </MouseLayout>
        {columns >= SHOWCASE_BRAND.length + 8 && (
          <Text
            color={hovered ? theme.colors.status.info : theme.colors.text.muted}
          >
            {hovered ? '● hover' : '○ hover'}
          </Text>
        )}
      </MouseLayout>
      {columns >= 100 && (
        <MouseLayout>
          <Text color={theme.colors.text.secondary}>{screenTitle}</Text>
        </MouseLayout>
      )}
      {showActions && (
        <ShellActionButtons
          themeMode={themeMode}
          onBack={onBack}
          canGoBack={canGoBack}
          onHome={onHome}
          onHelp={onHelp}
          onCommands={onCommands}
          onToggleTheme={onToggleTheme}
          includeBack={false}
        />
      )}
    </MouseLayout>
  )
}

function ShowcaseTopBar({
  columns,
  screenTitle,
  themeMode,
  onBack,
  canGoBack,
  onHome,
  onHelp,
  onCommands,
  onToggleTheme,
}: {
  columns: number
  screenTitle: string
  themeMode: ThemeMode
  onBack: () => void
  canGoBack: boolean
  onHome: () => void
  onHelp: () => void
  onCommands: () => void
  onToggleTheme: () => void
}) {
  const theme = useTheme()
  return (
    <MouseLayout
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
    >
      <MouseLayout flexShrink={0}>
        <Text bold color={theme.colors.text.primary}>{SHOWCASE_BRAND}</Text>
      </MouseLayout>
      {columns >= 100 && (
        <MouseLayout>
          <Text color={theme.colors.text.secondary}>{screenTitle}</Text>
        </MouseLayout>
      )}
      <ShellActionButtons
        themeMode={themeMode}
        onBack={onBack}
        canGoBack={canGoBack}
        onHome={onHome}
        onHelp={onHelp}
        onCommands={onCommands}
        onToggleTheme={onToggleTheme}
        includeBack={false}
      />
    </MouseLayout>
  )
}

function ShowcaseCommandPalette({
  registry,
  onClose,
}: {
  registry: ActionRegistry
  onClose: () => void
}) {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const results = registry.search(query)
  const stateRef = useRef({ results, selectedIndex, setSelectedIndex, onClose })
  stateRef.current = { results, selectedIndex, setSelectedIndex, onClose }
  const { pushScope, popScope } = useKeyboardScope()

  useEffect(() => setSelectedIndex(0), [query])
  useEffect(() => {
    pushScope('command')
    return () => popScope('command')
  }, [pushScope, popScope])

  useKeyHandler(
    (event) => {
      const state = stateRef.current
      if (event.escape) {
        state.onClose()
        return InputConsumptionResult.Consumed
      }
      if (event.up) {
        state.setSelectedIndex((index) => Math.max(0, index - 1))
        return InputConsumptionResult.Consumed
      }
      if (event.down) {
        state.setSelectedIndex((index) =>
          state.results.length === 0
            ? 0
            : Math.min(index + 1, state.results.length - 1),
        )
        return InputConsumptionResult.Consumed
      }
      if (event.enter) {
        state.results[state.selectedIndex]?.action.handler()
        state.onClose()
        return InputConsumptionResult.Consumed
      }
      return InputConsumptionResult.NotConsumed
    },
    'command',
    { priority: 80 },
  )

  const priorCategory = { value: '' }
  return (
    <MouseLayout
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.border.default}
      paddingX={1}
    >
      <MouseLayout
        flexDirection="row"
        justifyContent="space-between"
        marginBottom={1}
      >
        <MouseLayout flexDirection="row">
          <Text bold color={theme.colors.focus.active}>{'>'} </Text>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Type a command or search term"
            scope="command"
          />
        </MouseLayout>
        <Button variant="ghost" onActivate={onClose}>Close</Button>
      </MouseLayout>
      <Text dimColor>Click a command to run it · ↑/↓ then Enter also works</Text>
      <MouseLayout flexDirection="column" marginTop={1}>
        {results.length === 0 && (
          <Text dimColor>No matching commands found</Text>
        )}
        {results.map((match, index) => {
          const showCategory = match.action.category !== priorCategory.value
          priorCategory.value = match.action.category
          return (
            <MouseLayout key={`${match.action.id}:${index}`} flexDirection="column">
              {showCategory && (
                <Text bold dimColor>{match.action.category.toUpperCase()}</Text>
              )}
              <Button
                variant={index === selectedIndex ? 'primary' : 'ghost'}
                onActivate={() => {
                  match.action.handler()
                  onClose()
                }}
              >
                {match.action.label}
              </Button>
            </MouseLayout>
          )
        })}
      </MouseLayout>
    </MouseLayout>
  )
}

function CompactRouteNavigation({
  currentScreenId,
  onNavigate,
}: {
  currentScreenId: string
  onNavigate: (screenId: RouteId) => void
}) {
  return (
    <MouseLayout flexDirection="row" flexWrap="wrap" gap={1}>
      {sidebarItems.map((item) => (
        <Button
          key={item.id}
          variant={currentScreenId === item.id ? 'primary' : 'ghost'}
          onActivate={() => onNavigate(item.id as RouteId)}
        >
          {item.label}
        </Button>
      ))}
    </MouseLayout>
  )
}

function ShellActionButtons({
  themeMode,
  onBack,
  canGoBack,
  onHome,
  onHelp,
  onCommands,
  onToggleTheme,
  includeBack = true,
}: {
  themeMode: ThemeMode
  onBack: () => void
  canGoBack: boolean
  onHome: () => void
  onHelp: () => void
  onCommands: () => void
  onToggleTheme: () => void
  includeBack?: boolean
}) {
  return (
    <MouseLayout flexDirection="row" flexWrap="wrap" gap={1}>
      {includeBack && (
        <Button variant="ghost" disabled={!canGoBack} onActivate={onBack}>
          Back
        </Button>
      )}
      <Button variant="ghost" onActivate={onHome}>Home</Button>
      <Button variant="ghost" onActivate={onHelp}>Help</Button>
      <Button variant="ghost" onActivate={onCommands}>Commands</Button>
      <Button variant="ghost" onActivate={onToggleTheme}>
        Theme: {themeMode === 'dark' ? 'Light' : 'Dark'}
      </Button>
    </MouseLayout>
  )
}

/** Panel styling with measured ancestry for its interactive contents. */
function MeasuredPanel({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <MouseLayout
      borderStyle={theme.borderStyles.panel as 'round'}
      borderColor={theme.colors.border.default}
      flexDirection="column"
      paddingX={theme.spacing.sm}
    >
      {title != null && (
        <MouseLayout marginBottom={theme.spacing.xs}>
          <Text bold>{title}</Text>
        </MouseLayout>
      )}
      {children}
    </MouseLayout>
  )
}

function OverviewScreen() {
  const theme = useTheme()
  const { push } = useNavigation()

  return (
    <MouseLayout flexDirection="column">
      <MouseLayout marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>
          MAINTAINER BENCH
        </Text>
        <Text color={theme.colors.text.muted}>  /  v0.5.1</Text>
      </MouseLayout>
      <Text bold color={theme.colors.text.primary}>
        Public surface, in motion.
      </Text>
      <Text color={theme.colors.text.secondary}>
        A compact test bench for routes, controls, keyboard scope, and real process output.
      </Text>

      <MouseLayout marginTop={1}>
        <MeasuredPanel title="START / choose a track">
          <MouseLayout flexDirection="column">
            <Button variant="ghost" onActivate={() => push('controls')}>
              01  Controls · Inputs, lists, focus-aware picks
            </Button>
            <Button variant="ghost" onActivate={() => push('workflow')}>
              02  Workflow · ChoicePrompt into StepFlow
            </Button>
            <Button variant="ghost" onActivate={() => push('runtime')}>
              03  Process · Node child output
            </Button>
            <Button variant="ghost" onActivate={() => push('interactions')}>
              04  Input lab · Focus, keys, and mouse
            </Button>
          </MouseLayout>
          <MouseLayout marginTop={1} flexDirection="row" gap={1}>
            <Button
              variant="primary"
              onActivate={() => push('controls')}
            >
              Open control bench
            </Button>
          </MouseLayout>
        </MeasuredPanel>
      </MouseLayout>

      <MouseLayout marginTop={1}>
        <Text color={theme.colors.text.muted}>
          [1–4] push a route  ·  [b] pop  ·  [0] replace with overview
        </Text>
      </MouseLayout>
    </MouseLayout>
  )
}

const controlTabs = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Num' },
  { id: 'search', label: 'Find' },
  { id: 'list', label: 'List' },
  { id: 'radio', label: 'Radio' },
  { id: 'select', label: 'Pick' },
]

const searchableRows = [
  { id: 'focus', label: 'Focus tree', description: 'Roving focus + zones' },
  { id: 'process', label: 'Process runner', description: 'Child output lifecycle' },
  { id: 'palette', label: 'Command palette', description: 'Fuzzy action search' },
]

function ControlsScreen() {
  const theme = useTheme()
  const { toast } = useToast()
  const { canGoBack, pop } = useNavigation()
  const [activeTab, setActiveTab] = useState('text')
  const [textValue, setTextValue] = useState('')
  const [numberValue, setNumberValue] = useState(0)
  const [query, setQuery] = useState('')
  const [selectedRow, setSelectedRow] = useState('process')
  const [radioValue, setRadioValue] = useState('compact')
  const [listValue, setListValue] = useState('alpha')
  const submitText = useCallback(() => {
    if (!textValue.trim()) {
      toast('warning', 'Enter a value first.')
      return
    }
    toast('success', `Submitted: ${textValue}`)
  }, [textValue, toast])
  const activateSelected = useCallback(
    () => toast('success', `Opened ${selectedRow}.`),
    [selectedRow, toast],
  )

  const backFromControls = useCallback(() => {
    if (canGoBack) pop()
    else toast('info', 'Already at the start of this route.')
  }, [canGoBack, pop, toast])

  // Keep a back path inside the control scope when a widget suspends shell
  // navigation. Editable fields retain printable keys; their own handlers
  // consume `b` before this fallback can run.
  useKeyBinding('b', backFromControls, 'textinput', {
    enabled: activeTab !== 'text' && activeTab !== 'search',
  })

  return (
    <MouseLayout flexDirection="column">
      <MouseLayout marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>CONTROL DESK</Text>
        <Text color={theme.colors.text.muted}>  /  one keyboard scope at a time</Text>
      </MouseLayout>
      <Tabs
        tabs={controlTabs}
        activeTabId={activeTab}
        onChange={setActiveTab}
        scope="textinput"
      />
      <MouseLayout marginTop={1}>
        {activeTab === 'text' && (
          <MeasuredPanel title="TextInput / textinput scope">
            <Text color={theme.colors.text.secondary}>Type to append · Backspace deletes · Enter submits.</Text>
            <MouseLayout marginTop={1}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                placeholder="A short maintainer note"
                maxLength={28}
                validate={(value) => value.trim() ? null : 'Enter a value first.'}
                onSubmit={submitText}
                onCancel={() => setTextValue('')}
              />
            </MouseLayout>
            <MouseLayout marginTop={1}>
              <Button variant="primary" onActivate={submitText}>
                Submit note
              </Button>
            </MouseLayout>
            <Text color={theme.colors.text.muted}>Draft: {textValue || '—'}</Text>
          </MeasuredPanel>
        )}
        {activeTab === 'number' && (
          <MeasuredPanel title="NumberInput / bounded value">
            <Text color={theme.colors.text.secondary}>Type digits or use ↑/↓ by 5 · Enter commits · Esc resets.</Text>
            <MouseLayout marginTop={1}>
              <NumberInput
                value={numberValue}
                onChange={setNumberValue}
                onSubmit={(value) => toast('info', `Limit set to ${value}.`)}
                min={0}
                max={60}
                step={5}
                label="Limit"
              />
            </MouseLayout>
            <MouseLayout marginTop={1}>
              <Button
                variant="primary"
                onActivate={() => toast('info', `Limit set to ${numberValue}.`)}
              >
                Commit limit
              </Button>
            </MouseLayout>
            <Text color={theme.colors.text.muted}>Current value: {numberValue} / 60</Text>
          </MeasuredPanel>
        )}
        {activeTab === 'search' && (
          <MeasuredPanel title="SearchInput + SelectableList">
            <Text color={theme.colors.text.secondary}>Filter by label or id; click a row, then open the selection.</Text>
            <MouseLayout marginTop={1}>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter public features"
              />
            </MouseLayout>
            <MouseLayout marginTop={1}>
              <Button variant="primary" onActivate={activateSelected}>
                Open selected
              </Button>
            </MouseLayout>
            <MouseLayout marginTop={1}>
              <SelectableList
                items={searchableRows}
                filterQuery={query}
                selectedId={selectedRow}
                onSelect={setSelectedRow}
                onActivate={activateSelected}
                maxVisible={3}
              />
            </MouseLayout>
          </MeasuredPanel>
        )}
        {activeTab === 'radio' && (
          <MeasuredPanel title="RadioList / single choice">
            <Text color={theme.colors.text.secondary}>↑/↓ moves · Enter selects. The current choice stays controlled by React.</Text>
            <MouseLayout marginTop={1}>
              <RadioList
                options={[
                  { value: 'compact', label: 'Compact output' },
                  { value: 'verbose', label: 'Verbose output' },
                  { value: 'quiet', label: 'Quiet output' },
                ]}
                selected={radioValue}
                onSelect={(value) => {
                  setRadioValue(value)
                  toast('info', `Output mode: ${value}.`)
                }}
              />
            </MouseLayout>
            <Text color={theme.colors.text.muted}>Selected: {radioValue}</Text>
          </MeasuredPanel>
        )}
        {activeTab === 'list' && (
          <MeasuredPanel title="List / roving focus">
            <Text color={theme.colors.text.secondary}>Click a row to focus it, then activate the selection.</Text>
            <MouseLayout marginTop={1}>
              <List
                items={searchableRows}
                selectedId={selectedRow}
                onSelect={setSelectedRow}
                onActivate={(id) => toast('success', `Activated ${id}.`)}
                maxVisible={3}
              />
            </MouseLayout>
            <MouseLayout marginTop={1}>
              <Button
                variant="primary"
                onActivate={() => toast('success', `Activated ${selectedRow}.`)}
              >
                Activate selected
              </Button>
            </MouseLayout>
            <Text color={theme.colors.text.muted}>Focused row: {selectedRow}</Text>
          </MeasuredPanel>
        )}
        {activeTab === 'select' && (
          <MeasuredPanel title="ListSelect / return a typed value">
            <Text color={theme.colors.text.secondary}>Click an option or move with ↑/↓ and press Enter.</Text>
            <MouseLayout marginTop={1}>
              <ListSelect
                items={[
                  { value: 'alpha', label: 'Alpha / stable' },
                  { value: 'beta', label: 'Beta / preview' },
                  { value: 'nightly', label: 'Nightly / local' },
                ]}
                onSelect={(value) => {
                  setListValue(value)
                  toast('success', `Selected channel: ${value}.`)
                }}
              />
            </MouseLayout>
            <Text color={theme.colors.text.muted}>Last selection: {listValue}</Text>
          </MeasuredPanel>
        )}
      </MouseLayout>
      <MouseLayout marginTop={1}>
        <Text color={theme.colors.text.muted}>
          {activeTab === 'text' || activeTab === 'search'
            ? '←/→ changes the demo · printable keys stay in the field.'
            : '←/→ changes the demo · [b] back · vertical arrows stay in the widget.'}
        </Text>
      </MouseLayout>
    </MouseLayout>
  )
}

const workflowSteps: Step[] = [
  {
    id: 'inspect',
    title: 'Inspect',
    component: ({ data }) => (
      <MouseLayout flexDirection="column">
        <Text>Current track: {String(data.track ?? 'not set')}</Text>
        <Text dimColor>Review the selected option before moving on.</Text>
      </MouseLayout>
    ),
  },
  {
    id: 'configure',
    title: 'Configure',
    component: ({ data }) => (
      <MouseLayout flexDirection="column">
        <Text>Plan: {String(data.plan ?? 'safe default')}</Text>
        <Text dimColor>The step context carries values across screens.</Text>
        <Text dimColor>Press Enter to continue with the safe default.</Text>
      </MouseLayout>
    ),
  },
  {
    id: 'review',
    title: 'Review',
    component: ({ data }) => (
      <MouseLayout flexDirection="column">
        <Text>Ready to finish this small flow.</Text>
        <Text dimColor>Track: {String(data.track ?? '—')} · Plan: {String(data.plan ?? 'safe default')}</Text>
      </MouseLayout>
    ),
  },
]

function WorkflowScreen() {
  const theme = useTheme()
  const { toast } = useToast()
  const [phase, setPhase] = useState<'choice' | 'steps'>('choice')
  const [track, setTrack] = useState('')
  const cancelChoice = useCallback(
    () => toast('warning', 'No workflow started.'),
    [toast],
  )

  return (
    <MouseLayout flexDirection="column">
      <MouseLayout marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>WORKFLOW / 02</Text>
        <Text color={theme.colors.text.muted}>  /  a prompt hands off to a guided flow</Text>
      </MouseLayout>
      {phase === 'choice' ? (
        <MeasuredPanel title="ChoicePrompt / quick decision">
          <MouseLayout marginTop={1}>
            <Button variant="ghost" onActivate={cancelChoice}>Cancel workflow</Button>
          </MouseLayout>
          <ChoicePrompt
            label="Choose a neutral test track"
            items={[
              { value: 'Read-only check', label: 'Read-only check', description: 'Inspect without writing state' },
              { value: 'Configuration review', label: 'Configuration review', description: 'Review a setting change' },
              { value: 'Process probe', label: 'Process probe', description: 'Move on to a child process' },
            ]}
            onSelect={(item) => {
              setTrack(item.value)
              setPhase('steps')
              toast('info', `Workflow started: ${item.value}.`)
            }}
            onCancel={cancelChoice}
          />
          <MouseLayout marginTop={1} flexDirection="column">
            <Text dimColor>[a–c] choose · ↑/↓ move · Esc cancel</Text>
          </MouseLayout>
        </MeasuredPanel>
      ) : (
        <MeasuredPanel title="StepFlow / shared step context">
          <Text color={theme.colors.text.secondary}>ChoicePrompt result: {track}</Text>
          <MouseLayout marginTop={1}>
            <StepFlow
              key={track}
              steps={workflowSteps}
              initialData={{ track, plan: 'safe default' }}
              onComplete={(data) => {
                toast('success', `Flow complete: ${String(data.track)}.`)
                setPhase('choice')
              }}
              onCancel={() => setPhase('choice')}
            />
          </MouseLayout>
        </MeasuredPanel>
      )}
    </MouseLayout>
  )
}

const processScript = [
  "console.log('stdout / probe started')",
  "console.error('stderr / sample warning')",
  "console.log('stdout / probe finished')",
].join('; ')

function RuntimeScreen() {
  const theme = useTheme()
  const runner = useMemo(() => new NodeProcessRunner({ shell: false }), [])
  const session = useAsyncSession({ runner, maxOutputLines: 40 })
  const runningRef = useRef(session.isRunning)
  runningRef.current = session.isRunning
  const run = useCallback(() => {
    if (runningRef.current) return
    session.start(process.execPath, ['-e', processScript])
  }, [session.start])
  const cancel = session.cancel

  useRegisterActions([
    {
      id: 'run-process-probe',
      label: 'Run process probe',
      category: 'system',
      keys: ['r'],
      scope: 'navigation',
      group: 'process',
      handler: run,
    },
    {
      id: 'cancel-process-probe',
      label: 'Stop process probe',
      category: 'system',
      keys: ['c'],
      scope: 'navigation',
      group: 'process',
      handler: cancel,
    },
  ])

  useKeyBinding('r', run, 'navigation')
  useKeyBinding('c', cancel, 'navigation', { enabled: session.isRunning })

  const statusVariant = session.isRunning
    ? 'warning'
    : session.isError
      ? 'error'
      : session.isComplete
        ? 'success'
        : 'neutral'

  return (
    <MouseLayout flexDirection="column">
      <MouseLayout marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>PROCESS / 03</Text>
        <Text color={theme.colors.text.muted}>  /  actual Node child process</Text>
      </MouseLayout>
      <MeasuredPanel title="useAsyncSession + NodeProcessRunner">
        <Text color={theme.colors.text.secondary}>
          Direct argv · shell disabled · stdout and stderr stay separate.
        </Text>
        <MouseLayout marginTop={1} flexDirection="row" gap={2}>
          <Button
            variant="primary"
            focused={!session.isRunning}
            disabled={session.isRunning}
            onActivate={run}
          >
            Run probe
          </Button>
          <Button
            variant="danger"
            focused={session.isRunning}
            disabled={!session.isRunning}
            onActivate={cancel}
          >
            Stop
          </Button>
          <Text dimColor>[r] run  [c] stop</Text>
        </MouseLayout>
        <MouseLayout marginTop={1}>
          <Text color={theme.colors.text.muted}>Session </Text>
          <Text color={theme.colors.status[statusVariant === 'neutral' ? 'info' : statusVariant]}>
            {session.status.toUpperCase()}
          </Text>
          {session.exitCode !== null && (
            <Text color={theme.colors.text.secondary}>  exit {session.exitCode}</Text>
          )}
        </MouseLayout>
        <MouseLayout>
          <ProcessOutputPanel
            events={session.events}
            status={session.status}
            activeCommand={`${process.execPath} -e <probe>`}
            maxVisibleLines={5}
          />
        </MouseLayout>
      </MeasuredPanel>
    </MouseLayout>
  )
}

const interactionTabs = [
  { id: 'focus', label: 'Focus tree' },
  { id: 'keys', label: 'Keyboard trace' },
  { id: 'mouse', label: 'Mouse contract' },
  { id: 'experimental', label: 'Experimental' },
]

function InteractionScreen() {
  const theme = useTheme()
  const {
    activeTab,
    setActiveTab,
    compactMouse,
    shellScrollable,
    brandHovered,
    pointerMessage,
    dragMessage,
  } = useContext(InteractionTabContext)
  const [traceRevision, setTraceRevision] = useState(0)
  const [tracer] = useState(() => new EventTracer(4))
  const { toast } = useToast()

  useEffect(() => {
    tracer.enable()
    return () => tracer.disable()
  }, [tracer])

  // This screen-local observer records normalized keys that are not consumed
  // by an earlier navigation handler.
  useKeyHandler(
    (event) => {
      tracer.trace(event, { consumed: false, scope: 'navigation' })
      setTraceRevision((revision) => revision + 1)
      return InputConsumptionResult.NotConsumed
    },
    'navigation',
    { priority: -200 },
  )

  return (
    <MouseLayout flexDirection="column">
      <MouseLayout marginBottom={compactMouse ? 0 : 1}>
        <Text bold color={theme.colors.focus.active}>
          {compactMouse ? 'INPUT LAB / 04 · MOUSE CONTRACT' : 'INPUT LAB / 04'}
        </Text>
        {!compactMouse && (
          <Text color={theme.colors.text.muted}>  /  observable contracts, not assumptions</Text>
        )}
      </MouseLayout>
      <Tabs
        tabs={interactionTabs}
        activeTabId={activeTab}
        onChange={setActiveTab}
        scope="navigation"
      />
      <MouseLayout marginTop={1}>
        {activeTab === 'focus' && (
          <FocusTreeDemo
            onChoose={(value) => toast('success', `Focused action: ${value}.`)}
          />
        )}
        {activeTab === 'keys' && (
          <MeasuredPanel title="EventTracer + KeyboardDebugInspector">
            <Text color={theme.colors.text.secondary}>
              Normalized navigation keys reaching a low-priority observer.
            </Text>
            <Text color={theme.colors.text.muted}>
              Inputs consumed earlier are not shown; this is not a full dispatch-chain log.
            </Text>
            <MouseLayout marginTop={1}>
              <KeyboardDebugInspector key={traceRevision} tracer={tracer} />
            </MouseLayout>
          </MeasuredPanel>
        )}
        {activeTab === 'mouse' && (
          <MouseContractDemo
            compact={compactMouse}
            shellScrollable={shellScrollable}
            brandHovered={brandHovered}
            pointerMessage={pointerMessage}
            dragMessage={dragMessage}
          />
        )}
        {activeTab === 'experimental' && <ExperimentalDemo />}
      </MouseLayout>
      {!compactMouse && (
        <MouseLayout marginTop={1}>
          <Text color={theme.colors.text.muted}>←/→ changes section · Tab moves between focus zones · Esc closes overlays.</Text>
        </MouseLayout>
      )}
    </MouseLayout>
  )
}

function FocusTreeDemo({ onChoose }: { onChoose: (value: string) => void }) {
  const theme = useTheme()
  return (
    <MeasuredPanel title="FocusTree / zones + roving groups">
      <Text color={theme.colors.text.secondary}>Click a row to choose · Tab switches zone · ↑/↓ moves focus.</Text>
      <MouseLayout marginTop={1} flexDirection="column">
        <FocusZonePanel
          zoneId="showcase-focus-navigation"
          groupId="showcase-focus-navigation-items"
          order={2}
          title="ZONE A / navigation"
          items={['Open a route', 'Return to root']}
          onChoose={onChoose}
        />
        <MouseLayout marginTop={1}>
          <FocusZonePanel
            zoneId="showcase-focus-actions"
            groupId="showcase-focus-action-items"
            order={3}
            title="ZONE B / actions"
            items={['Inspect a control', 'Check a session']}
            onChoose={onChoose}
          />
        </MouseLayout>
      </MouseLayout>
      <MouseLayout marginTop={1}>
        <Text color={theme.colors.text.muted}>The cyan marker is current roving focus; Tab shifts the active zone.</Text>
      </MouseLayout>
    </MeasuredPanel>
  )
}

function FocusZonePanel({
  zoneId,
  groupId,
  order,
  title,
  items,
  onChoose,
}: {
  zoneId: string
  groupId: string
  order: number
  title: string
  items: string[]
  onChoose: (value: string) => void
}) {
  const { ZoneProvider } = useFocusZone(zoneId, {
    scope: 'navigation',
    orientation: 'horizontal',
    order,
  })

  return (
    <ZoneProvider>
      <FocusGroupPanel groupId={groupId} title={title} items={items} onChoose={onChoose} />
    </ZoneProvider>
  )
}

function FocusGroupPanel({
  groupId,
  title,
  items,
  onChoose,
}: {
  groupId: string
  title: string
  items: string[]
  onChoose: (value: string) => void
}) {
  const theme = useTheme()
  const {
    GroupProvider,
    focusedId,
    isActive,
    activate: activateGroup,
  } = useFocusGroup(groupId, {
    autoFocus: true,
    scope: 'navigation',
  })
  const itemIds = items.map((_, index) => `${groupId}-${index}`)
  return (
    <GroupProvider>
      <MouseLayout flexDirection="column">
        <Text bold color={theme.colors.text.muted}>{title}</Text>
        {items.map((label, index) => (
          <FocusRow
            key={itemIds[index]}
            id={itemIds[index]}
            label={label}
            focused={isActive && focusedId === itemIds[index]}
            onActivate={() => {
              activateGroup()
              onChoose(label)
            }}
          />
        ))}
      </MouseLayout>
    </GroupProvider>
  )
}

function FocusRow({
  id,
  label,
  focused,
  onActivate,
}: {
  id: string
  label: string
  focused: boolean
  onActivate: () => void
}) {
  const { onActivate: focusRow } = useFocusable({ id })
  return (
    <Button
      variant="default"
      focused={focused}
      onActivate={() => {
        focusRow()
        onActivate()
      }}
    >
      {focused ? '› ' : '  '}{label}
    </Button>
  )
}

const mouseListRows = [
  { id: 'overview', label: '01 / Overview · route map' },
  { id: 'controls', label: '02 / Controls · inputs and lists' },
  { id: 'workflow', label: '03 / Workflow · guided steps' },
  { id: 'process', label: '04 / Process · child output' },
  { id: 'focus', label: '05 / Focus · zones and groups' },
  { id: 'mouse', label: '06 / Mouse · clicks and wheel' },
  { id: 'themes', label: '07 / Themes · dark and light' },
]

function MouseContractDemo({
  compact,
  shellScrollable,
  brandHovered,
  pointerMessage,
  dragMessage,
}: {
  compact: boolean
  shellScrollable: boolean
  brandHovered: boolean
  pointerMessage: string
  dragMessage: string
}) {
  const theme = useTheme()
  const { toast } = useToast()
  const [buttonActivations, setButtonActivations] = useState(0)
  const [listActivations, setListActivations] = useState(0)
  const [focusedRow, setFocusedRow] = useState('overview')
  const focusedLabel =
    mouseListRows.find((row) => row.id === focusedRow)?.label ?? '—'

  return (
    <MouseLayout
      borderStyle={compact ? undefined : 'round'}
      borderColor={compact ? undefined : theme.colors.border.default}
      flexDirection="column"
      paddingX={compact ? 0 : 2}
    >
      <Text bold color={theme.colors.text.primary}>
        {compact
          ? 'MouseLayout / measured targets · click rows'
          : 'MouseLayout / measured targets'}
      </Text>

      <MouseLayout flexDirection="row" gap={2}>
        <Button
          variant="primary"
          focused
          onActivate={() => setButtonActivations((count) => count + 1)}
        >
          Run mouse action
        </Button>
        <Text dimColor>Button activations: {buttonActivations}</Text>
      </MouseLayout>

      <MouseLayout flexDirection="column">
        <Text bold color={theme.colors.text.primary}>
          Hover + drag / app name in the top bar
        </Text>
        <Text color={brandHovered ? theme.colors.focus.ring : theme.colors.text.secondary}>
          {compact ? dragMessage || pointerMessage : pointerMessage}
        </Text>
        {!compact && (
          <Text color={theme.colors.text.secondary}>
            {dragMessage || 'Press and move on the app name to test dragging.'}
          </Text>
        )}
      </MouseLayout>

      <MouseLayout flexDirection="column">
        <Text bold color={theme.colors.text.primary}>
          Scrollable List / 7 rows · shows {compact ? 1 : 3}
        </Text>
        <List
          items={mouseListRows}
          selectedId={focusedRow}
          onSelect={setFocusedRow}
          onActivate={() => setListActivations((count) => count + 1)}
          maxVisible={compact ? 1 : 3}
          renderItem={(item, state) => (
            <Text
              color={
                state.focused
                  ? theme.colors.focus.ring
                  : state.selected
                    ? theme.colors.focus.active
                    : theme.colors.text.primary
              }
              underline={state.hovered}
              bold={state.focused || state.selected}
            >
              {state.focused ? '› ' : '  '}{item.label}
            </Text>
          )}
        />
        <Text color={theme.colors.text.muted}>Keyboard focus: {focusedLabel}</Text>
        {!compact && (
          <Text color={theme.colors.text.muted}>
            List activations: {listActivations}
          </Text>
        )}
      </MouseLayout>

      {(!compact || shellScrollable) && (
        <MouseLayout marginTop={compact ? 0 : 1} flexDirection="column">
          <Text color={theme.colors.text.muted}>
            {shellScrollable
              ? 'List scrolls first; the shell scrolls only when its viewport has overflow.'
              : 'List handles wheel; this Mouse tab stays in normal flow.'}
          </Text>
          <Text color={theme.colors.text.muted}>
            MouseLayout uses the alternate-screen origin at (0,0).
          </Text>
          <Text color={theme.colors.text.muted}>
            The app opts into alternate screen.
          </Text>
          <Text color={theme.colors.text.muted}>
            No terminal-emulator compatibility is claimed.
          </Text>
          {shellScrollable && (
            <Text color={theme.colors.text.muted}>
              Terminal mouse reports use SGR; Windows host normalizes native events.
            </Text>
          )}
        </MouseLayout>
      )}
    </MouseLayout>
  )
}

function ExperimentalDemo() {
  const theme = useTheme()
  const { push } = useNavigation()
  const actions = useActiveActions()
  const collisions = detectCollisions(actions)
  const goToProcess = useCallback(() => push('runtime'), [push])
  const keyboardRegistry = useMemo(() => {
    const registry = new KeyboardRegistry()
    registry.register({
      keys: 'g',
      scope: 'navigation',
      handler: goToProcess,
      description: 'Open the process session',
    })
    return registry
  }, [goToProcess])

  useKeyBinding('g', goToProcess, 'navigation')

  return (
    <MeasuredPanel title="Experimental / explicitly labeled">
      <Text color={theme.colors.text.secondary}>ScreenTransition wraps every route change in this lab.</Text>
      <Text color={theme.colors.text.muted}>KeyboardRegistry is experimental metadata; this live “g” route uses useKeyBinding.</Text>
      <MouseLayout marginTop={1} flexDirection="column">
        {keyboardRegistry.getAll().map((binding) => (
          <Text key={`${binding.scope}:${binding.keys}`} color={theme.colors.text.primary}>
            {binding.keys}  {binding.description}  <Text dimColor>({binding.scope})</Text>
          </Text>
        ))}
      </MouseLayout>
      <MouseLayout marginTop={1}>
        <Text color={theme.colors.text.muted}>Scoped actions: </Text>
        <Text color={theme.colors.focus.active}>{actions.length}</Text>
        <Text color={theme.colors.text.muted}> · detected collisions: </Text>
        <Text color={collisions.length ? theme.colors.status.warning : theme.colors.status.success}>
          {collisions.length}
        </Text>
      </MouseLayout>
      {collisions.length > 0 && (
        <MouseLayout flexDirection="column">
          {collisions.slice(0, 2).map((collision) => (
            <Text key={`${collision.action1Id}:${collision.action2Id}`} color={theme.colors.status.warning}>
              {collision.key} · {collision.scope1}/{collision.scope2}
            </Text>
          ))}
        </MouseLayout>
      )}
      <MouseLayout marginTop={1}>
        <Button variant="primary" onActivate={goToProcess}>
          Open process session
        </Button>
      </MouseLayout>
    </MeasuredPanel>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  return (
    <ModalDialog
      title="Feature Lab / quick keys"
      onClose={onClose}
      width={54}
      footer={[
        {
          id: 'close-help',
          label: 'Close',
          category: 'system',
          keys: ['escape'],
          handler: onClose,
        },
      ]}
    >
      <Box flexDirection="column">
        <Text color={theme.colors.text.secondary}>ctrl+p  Search the public shell actions</Text>
        <Text color={theme.colors.text.secondary}>1–4    Push a route · b pops history</Text>
        <Text color={theme.colors.text.secondary}>0      Replace the route with Overview</Text>
        <Text color={theme.colors.text.secondary}>t      Toggle the framework theme</Text>
        <Text color={theme.colors.text.secondary}>f      Show a toast · ? opens this guide</Text>
        <Text color={theme.colors.text.muted}>Sidebar hides below 80 columns or in a short terminal; command search remains available.</Text>
      </Box>
    </ModalDialog>
  )
}
