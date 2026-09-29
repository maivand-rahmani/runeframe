import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box, Text, useWindowSize } from 'ink'
import {
  ActionRegistry,
  AppShell,
  Breadcrumbs,
  Button,
  ChoicePrompt,
  CommandPalette,
  detectCollisions,
  EventTracer,
  FrameworkProvider,
  HotkeyHintBar,
  KeyboardDebugInspector,
  List,
  ListSelect,
  ModalDialog,
  MouseArea,
  NumberInput,
  NodeProcessRunner,
  Panel,
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
  useModal,
  useNavigation,
  useRegisterActions,
  useTheme,
  useToast,
  InputConsumptionResult,
  type Action,
  type Step,
} from 'runeframe'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'

type RouteId = 'overview' | 'controls' | 'workflow' | 'runtime' | 'interactions'
type ThemeMode = 'dark' | 'light'

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

export function ShowcaseApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const toggleTheme = useCallback(() => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <FrameworkProvider
      registry={screenRegistry}
      defaultScreen="overview"
      themeMode={themeMode}
    >
      <ShowcaseFrame themeMode={themeMode} onToggleTheme={toggleTheme} />
    </FrameworkProvider>
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
  const { currentScreen, currentScreenId, canGoBack, push, pop, replace } =
    useNavigation()
  const { openModal } = useModal()
  const { toast } = useToast()
  const theme = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)

  const back = useCallback(() => {
    if (canGoBack) pop()
    else toast('info', 'Already at the start of this route.')
  }, [canGoBack, pop, toast])
  const reset = useCallback(() => replace('overview'), [replace])
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
      footer={<Text dimColor>0 reset · b back</Text>}
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
        <HotkeyHintBar scope="navigation" maxHints={columns < 64 ? 1 : 3} />
      </Box>
    </Box>
  )

  return (
    <Box
      flexDirection="column"
      width={columns}
      backgroundColor={theme.colors.surface.base}
    >
      <AppShell
        columns={columns}
        sidebar={compactHeight ? undefined : sidebar}
        sidebarPosition="fixed"
        topBar={
          <TopBar
            appName="RUNEFRAME / FEATURE LAB"
            screenTitle={currentScreen.title}
            columns={columns}
          />
        }
        statusBar={rows < 12 ? undefined : status}
      >
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color={theme.colors.text.muted}>PATH </Text>
            <Breadcrumbs maxItems={3} />
            {canGoBack && <Text color={theme.colors.text.muted}>  [b] back</Text>}
          </Box>
          {paletteOpen ? (
            <CommandPalette
              registry={commandRegistry}
              onClose={() => setPaletteOpen(false)}
            />
          ) : (
            <ScreenTransition type="fade" duration={90}>
              <ScreenOutlet />
            </ScreenTransition>
          )}
          {!compactHeight && (
            <Text dimColor>
              [ctrl+p] commands  [t] theme  [?] help  [0] replace route
            </Text>
          )}
        </Box>
      </AppShell>
    </Box>
  )
}

function LiveActionCount() {
  const actions = useActiveActions()
  return <Text dimColor>{actions.length} actions</Text>
}

function OverviewScreen() {
  const theme = useTheme()
  const { push } = useNavigation()

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>
          MAINTAINER BENCH
        </Text>
        <Text color={theme.colors.text.muted}>  /  v0.5.0</Text>
      </Box>
      <Text bold color={theme.colors.text.primary}>
        Public surface, in motion.
      </Text>
      <Text color={theme.colors.text.secondary}>
        A compact test bench for routes, controls, keyboard scope, and real process output.
      </Text>

      <Box marginTop={1}>
        <Panel title="START / choose a track">
          <Box flexDirection="column">
            <Text color={theme.colors.text.secondary}>01  Controls      Inputs, lists, focus-aware picks</Text>
            <Text color={theme.colors.text.secondary}>02  Workflow      ChoicePrompt into StepFlow</Text>
            <Text color={theme.colors.text.secondary}>03  Process       Node child process, stdout + stderr</Text>
            <Text color={theme.colors.text.secondary}>04  Input lab     Focus tree, trace, mouse contract</Text>
          </Box>
          <Box marginTop={1}>
            <Button
              variant="primary"
              focused
              onActivate={() => push('controls')}
            >
              Open control bench
            </Button>
            <Text dimColor>  Enter</Text>
          </Box>
        </Panel>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>
          [1–4] push a route  ·  [b] pop  ·  [0] replace with overview
        </Text>
      </Box>
    </Box>
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
  const [selectedRow, setSelectedRow] = useState('focus')
  const [radioValue, setRadioValue] = useState('compact')
  const [listValue, setListValue] = useState('alpha')

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
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>CONTROL DESK</Text>
        <Text color={theme.colors.text.muted}>  /  one keyboard scope at a time</Text>
      </Box>
      <Tabs
        tabs={controlTabs}
        activeTabId={activeTab}
        onChange={setActiveTab}
        scope="textinput"
      />
      <Box marginTop={1}>
        {activeTab === 'text' && (
          <Panel title="TextInput / textinput scope">
            <Text color={theme.colors.text.secondary}>Type to append · Backspace deletes · Enter submits.</Text>
            <Box marginTop={1}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                placeholder="A short maintainer note"
                maxLength={28}
                validate={(value) => value.trim() ? null : 'Enter a value first.'}
                onSubmit={(value) => toast('success', `Submitted: ${value}`)}
                onCancel={() => setTextValue('')}
              />
            </Box>
            <Text color={theme.colors.text.muted}>Draft: {textValue || '—'}</Text>
          </Panel>
        )}
        {activeTab === 'number' && (
          <Panel title="NumberInput / bounded value">
            <Text color={theme.colors.text.secondary}>Type digits or use ↑/↓ by 5 · Enter commits · Esc resets.</Text>
            <Box marginTop={1}>
              <NumberInput
                value={numberValue}
                onChange={setNumberValue}
                onSubmit={(value) => toast('info', `Limit set to ${value}.`)}
                min={0}
                max={60}
                step={5}
                label="Limit"
              />
            </Box>
            <Text color={theme.colors.text.muted}>Current value: {numberValue} / 60</Text>
          </Panel>
        )}
        {activeTab === 'search' && (
          <Panel title="SearchInput + SelectableList">
            <Text color={theme.colors.text.secondary}>Filter by label or id; arrows move focus; Enter opens the row.</Text>
            <Box marginTop={1}>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter public features"
              />
            </Box>
            <Box marginTop={1}>
              <SelectableList
                items={searchableRows}
                filterQuery={query}
                selectedId={selectedRow}
                onSelect={setSelectedRow}
                onActivate={(id) => toast('success', `Opened ${id}.`)}
                maxVisible={3}
              />
            </Box>
          </Panel>
        )}
        {activeTab === 'radio' && (
          <Panel title="RadioList / single choice">
            <Text color={theme.colors.text.secondary}>↑/↓ moves · Enter selects. The current choice stays controlled by React.</Text>
            <Box marginTop={1}>
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
            </Box>
            <Text color={theme.colors.text.muted}>Selected: {radioValue}</Text>
          </Panel>
        )}
        {activeTab === 'list' && (
          <Panel title="List / roving focus">
            <Text color={theme.colors.text.secondary}>↑/↓ changes focus · Enter activates · selection follows focus.</Text>
            <Box marginTop={1}>
              <List
                items={searchableRows}
                selectedId={selectedRow}
                onSelect={setSelectedRow}
                onActivate={(id) => toast('success', `Activated ${id}.`)}
                maxVisible={3}
              />
            </Box>
            <Text color={theme.colors.text.muted}>Focused row: {selectedRow}</Text>
          </Panel>
        )}
        {activeTab === 'select' && (
          <Panel title="ListSelect / return a typed value">
            <Text color={theme.colors.text.secondary}>Move with ↑/↓, then Enter. Selection is passed to the caller.</Text>
            <Box marginTop={1}>
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
            </Box>
            <Text color={theme.colors.text.muted}>Last selection: {listValue}</Text>
          </Panel>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>
          {activeTab === 'text' || activeTab === 'search'
            ? '←/→ changes the demo · printable keys stay in the field.'
            : '←/→ changes the demo · [b] back · vertical arrows stay in the widget.'}
        </Text>
      </Box>
    </Box>
  )
}

const workflowSteps: Step[] = [
  {
    id: 'inspect',
    title: 'Inspect',
    component: ({ data }) => (
      <Box flexDirection="column">
        <Text>Current track: {String(data.track ?? 'not set')}</Text>
        <Text dimColor>Review the selected option before moving on.</Text>
      </Box>
    ),
  },
  {
    id: 'configure',
    title: 'Configure',
    component: ({ data }) => (
      <Box flexDirection="column">
        <Text>Plan: {String(data.plan ?? 'safe default')}</Text>
        <Text dimColor>The step context carries values across screens.</Text>
        <Text dimColor>Press Enter to continue with the safe default.</Text>
      </Box>
    ),
  },
  {
    id: 'review',
    title: 'Review',
    component: ({ data }) => (
      <Box flexDirection="column">
        <Text>Ready to finish this small flow.</Text>
        <Text dimColor>Track: {String(data.track ?? '—')} · Plan: {String(data.plan ?? 'safe default')}</Text>
      </Box>
    ),
  },
]

function WorkflowScreen() {
  const theme = useTheme()
  const { toast } = useToast()
  const [phase, setPhase] = useState<'choice' | 'steps'>('choice')
  const [track, setTrack] = useState('')

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>WORKFLOW / 02</Text>
        <Text color={theme.colors.text.muted}>  /  a prompt hands off to a guided flow</Text>
      </Box>
      {phase === 'choice' ? (
        <Panel title="ChoicePrompt / quick decision">
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
            onCancel={() => toast('warning', 'No workflow started.')}
          />
          <Box marginTop={1}>
            <Text dimColor>[a–c] choose · ↑/↓ move · Esc cancel</Text>
          </Box>
        </Panel>
      ) : (
        <Panel title="StepFlow / shared step context">
          <Text color={theme.colors.text.secondary}>ChoicePrompt result: {track}</Text>
          <Box marginTop={1}>
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
          </Box>
        </Panel>
      )}
    </Box>
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
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>PROCESS / 03</Text>
        <Text color={theme.colors.text.muted}>  /  actual Node child process</Text>
      </Box>
      <Panel title="useAsyncSession + NodeProcessRunner">
        <Text color={theme.colors.text.secondary}>
          Direct argv · shell disabled · stdout and stderr stay separate.
        </Text>
        <Box marginTop={1} flexDirection="row" gap={2}>
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
        </Box>
        <Box marginTop={1}>
          <Text color={theme.colors.text.muted}>Session </Text>
          <Text color={theme.colors.status[statusVariant === 'neutral' ? 'info' : statusVariant]}>
            {session.status.toUpperCase()}
          </Text>
          {session.exitCode !== null && (
            <Text color={theme.colors.text.secondary}>  exit {session.exitCode}</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <ProcessOutputPanel
            events={session.events}
            status={session.status}
            activeCommand={`${process.execPath} -e <probe>`}
            maxVisibleLines={5}
          />
        </Box>
      </Panel>
      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>The command runs from the current Node executable; no shell string is assembled.</Text>
      </Box>
    </Box>
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
  const [activeTab, setActiveTab] = useState('focus')
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
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.focus.active}>INPUT LAB / 04</Text>
        <Text color={theme.colors.text.muted}>  /  observable contracts, not assumptions</Text>
      </Box>
      <Tabs
        tabs={interactionTabs}
        activeTabId={activeTab}
        onChange={setActiveTab}
        scope="navigation"
      />
      <Box marginTop={1}>
        {activeTab === 'focus' && (
          <FocusTreeDemo
            onChoose={(value) => toast('success', `Focused action: ${value}.`)}
          />
        )}
        {activeTab === 'keys' && (
          <Panel title="EventTracer + KeyboardDebugInspector">
            <Text color={theme.colors.text.secondary}>
              Normalized navigation keys reaching a low-priority observer.
            </Text>
            <Text color={theme.colors.text.muted}>
              Inputs consumed earlier are not shown; this is not a full dispatch-chain log.
            </Text>
            <Box marginTop={1}>
              <KeyboardDebugInspector key={traceRevision} tracer={tracer} />
            </Box>
          </Panel>
        )}
        {activeTab === 'mouse' && <MouseContractDemo />}
        {activeTab === 'experimental' && <ExperimentalDemo />}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>←/→ changes section · Tab moves between focus zones · Esc closes overlays.</Text>
      </Box>
    </Box>
  )
}

function FocusTreeDemo({ onChoose }: { onChoose: (value: string) => void }) {
  const theme = useTheme()
  return (
    <Panel title="FocusTree / zones + roving groups">
      <Text color={theme.colors.text.secondary}>Tab switches zone · ↑/↓ moves inside a group · Enter chooses.</Text>
      <Box marginTop={1} flexDirection="column">
        <FocusZonePanel
          zoneId="showcase-focus-navigation"
          groupId="showcase-focus-navigation-items"
          order={2}
          title="ZONE A / navigation"
          items={['Open a route', 'Return to root']}
          onChoose={onChoose}
        />
        <Box marginTop={1}>
          <FocusZonePanel
            zoneId="showcase-focus-actions"
            groupId="showcase-focus-action-items"
            order={3}
            title="ZONE B / actions"
            items={['Inspect a control', 'Check a session']}
            onChoose={onChoose}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>The cyan marker is current roving focus; Tab shifts the active zone.</Text>
      </Box>
    </Panel>
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
  const { GroupProvider, focusedId, isActive } = useFocusGroup(groupId, {
    autoFocus: true,
    scope: 'navigation',
  })
  const itemIds = items.map((_, index) => `${groupId}-${index}`)
  const focusRef = useRef({ focusedId, isActive, items, itemIds, onChoose })
  focusRef.current = { focusedId, isActive, items, itemIds, onChoose }

  useKeyHandler(
    (event) => {
      const current = focusRef.current
      if (!current.isActive || !event.enter) return InputConsumptionResult.NotConsumed
      const index = current.itemIds.indexOf(current.focusedId ?? '')
      if (index >= 0) current.onChoose(current.items[index])
      return InputConsumptionResult.Consumed
    },
    'navigation',
    { enabled: isActive },
  )

  return (
    <GroupProvider>
      <Box flexDirection="column">
        <Text bold color={theme.colors.text.muted}>{title}</Text>
        {items.map((label, index) => (
          <FocusRow key={itemIds[index]} id={itemIds[index]} label={label} />
        ))}
      </Box>
    </GroupProvider>
  )
}

function FocusRow({ id, label }: { id: string; label: string }) {
  const theme = useTheme()
  const { focused } = useFocusable({ id })
  return (
    <Text color={focused ? theme.colors.focus.ring : theme.colors.text.primary} bold={focused}>
      {focused ? '› ' : '  '}{label}
    </Text>
  )
}

const mouseBounds = { x: 0, y: 0, width: 24, height: 1 }

function MouseContractDemo() {
  const theme = useTheme()
  const { toast } = useToast()
  return (
    <Panel title="MouseArea / caller-owned geometry">
      <Text color={theme.colors.text.secondary}>One explicit rectangle, supplied in zero-based terminal cells:</Text>
      <Box marginTop={1}>
        <MouseArea
          bounds={mouseBounds}
          scope="navigation"
          onClick={({ x, y }) => toast('info', `Reported click: x=${x}, y=${y}.`)}
        >
          <Text color={theme.colors.focus.active}>[ demo target · x=0 y=0 w=24 h=1 ]</Text>
        </MouseArea>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.colors.text.primary}>No automatic Ink layout hit testing.</Text>
        <Text color={theme.colors.text.secondary}>No hover, drag, or wheel events.</Text>
        <Text color={theme.colors.text.secondary}>This app makes no terminal-emulator compatibility claim.</Text>
        <Text color={theme.colors.text.muted}>TTY-gated SGR capture is not verified end to end here.</Text>
      </Box>
      <Text color={theme.colors.text.muted}>The rectangle does not move with the printed row; it is an explicit caller assertion.</Text>
    </Panel>
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
    <Panel title="Experimental / explicitly labeled">
      <Text color={theme.colors.text.secondary}>ScreenTransition wraps every route change in this lab.</Text>
      <Text color={theme.colors.text.muted}>KeyboardRegistry is experimental metadata; this live “g” route uses useKeyBinding.</Text>
      <Box marginTop={1} flexDirection="column">
        {keyboardRegistry.getAll().map((binding) => (
          <Text key={`${binding.scope}:${binding.keys}`} color={theme.colors.text.primary}>
            {binding.keys}  {binding.description}  <Text dimColor>({binding.scope})</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.text.muted}>Scoped actions: </Text>
        <Text color={theme.colors.focus.active}>{actions.length}</Text>
        <Text color={theme.colors.text.muted}> · detected collisions: </Text>
        <Text color={collisions.length ? theme.colors.status.warning : theme.colors.status.success}>
          {collisions.length}
        </Text>
      </Box>
      {collisions.length > 0 && (
        <Box flexDirection="column">
          {collisions.slice(0, 2).map((collision) => (
            <Text key={`${collision.action1Id}:${collision.action2Id}`} color={theme.colors.status.warning}>
              {collision.key} · {collision.scope1}/{collision.scope2}
            </Text>
          ))}
        </Box>
      )}
    </Panel>
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
