import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import chalk from 'chalk'
import type { FrameworkProviderProps } from 'runeframe'
// The app is imported from its local source; every framework API it uses is
// resolved from the repository `src` entry points through the `runeframe`
// alias (no published package copy).
import { ShowcaseApp } from '../src/App.js'

/** Mirrors the opt-in sink type exposed through `ShowcaseAppProps`. */
type MouseRoutingDiagnostic = Parameters<
  NonNullable<FrameworkProviderProps['mouseDiagnostics']>
>[0]

/** Normalized event shape accepted by the forwarded mouse event source. */
type SourceMouseEvent = Parameters<
  Parameters<NonNullable<FrameworkProviderProps['mouseEventSource']>['subscribe']>[0]
>[0]

/**
 * In-memory mouse event source double. Nothing here parses bytes: tests emit
 * already-normalized events, exactly like the SGR input multiplexer does.
 */
function createFakeMouseEventSource() {
  const listeners = new Set<(event: SourceMouseEvent) => void>()
  return {
    subscribe(listener: (event: SourceMouseEvent) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(event: SourceMouseEvent) {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

type AppRender = ReturnType<typeof render>

const activeRenders: AppRender[] = []

function renderApp(): AppRender {
  const app = render(<ShowcaseApp />)
  activeRenders.push(app)
  return app
}

afterEach(() => {
  while (activeRenders.length > 0) {
    activeRenders.pop()?.unmount()
  }
})

const ANSI_PATTERN = /\u001b\[[?>=<]?[0-9;]*[A-Za-z]/g

function frameText(app: AppRender): string {
  return (app.lastFrame() ?? '').replace(ANSI_PATTERN, '')
}

function waitForFrame(
  app: AppRender,
  expected: string,
  timeout = 15000,
): Promise<void> {
  return vi.waitFor(
    () => {
      expect(frameText(app)).toContain(expected)
    },
    { timeout, interval: 25 },
  )
}

function waitForFrameWithout(
  app: AppRender,
  unexpected: string,
  timeout = 15000,
): Promise<void> {
  return vi.waitFor(
    () => {
      expect(frameText(app)).not.toContain(unexpected)
    },
    { timeout, interval: 25 },
  )
}

// Ink flushes a frame during commit while `useEffect`-based handler
// registration runs one task later, so a key sent immediately after a route
// change can race the new screen's registration. Re-send the key until its
// expected frame arrives; every retried key below is idempotent or guarded by
// the app itself (process runs are guarded by session state).
const settle = (ms = 50): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function withColorOutput(run: () => Promise<void>): Promise<void> {
  const previousLevel = chalk.level
  chalk.level = 1
  try {
    await run()
  } finally {
    chalk.level = previousLevel
  }
}

function cellForText(
  app: AppRender,
  text: string,
): { column: number; row: number } {
  const lines = frameText(app).split(/\r?\n/)
  const row = lines.findIndex((line) => line.includes(text))
  if (row < 0) {
    throw new Error('Text is not visible in the rendered frame: ' + text)
  }
  const column = lines[row]!.indexOf(text) + Math.floor(text.length / 2)
  return { column, row }
}

function setTtyRows(
  app: AppRender,
  rows: number,
  node: ReactElement = <ShowcaseApp />,
): void {
  const stdout = app.stdout as unknown as {
    isTTY: boolean
    rows: number
    emit: (event: 'resize') => void
  }
  app.stdin.isTTY = true
  stdout.isTTY = true
  stdout.rows = rows
  stdout.emit('resize')
  // MouseProvider enables reporting only for a TTY. Re-render after marking
  // Ink's in-process stdout TTY-like so its own enable sequence is captured.
  // Callers with extra props must pass the same element again: rerendering a
  // bare `<ShowcaseApp />` would drop them.
  app.rerender(node)
}

function frameRowCount(app: AppRender): number {
  return frameText(app).split(/\r?\n/).length
}

// These synthetic packets verify routing only, not PTY or emulator behavior.
function sendSgrMouse(
  app: AppRender,
  button: number,
  cell: { column: number; row: number },
  release = false,
): void {
  const packet =
    String.fromCharCode(27) +
    '[<' +
    button +
    ';' +
    (cell.column + 1) +
    ';' +
    (cell.row + 1) +
    (release ? 'm' : 'M')
  app.stdin.write(packet)
}

async function clickText(app: AppRender, text: string): Promise<void> {
  const cell = cellForText(app, text)
  sendSgrMouse(app, 0, cell)
  await settle()
  sendSgrMouse(app, 0, cell, true)
}

function wheelDownAtText(app: AppRender, text: string): void {
  sendSgrMouse(app, 65, cellForText(app, text))
}

function emitSourceMove(
  source: ReturnType<typeof createFakeMouseEventSource>,
  button: 'left' | 'none',
  cell: { column: number; row: number },
): void {
  source.emit({
    type: 'move',
    button,
    x: cell.column,
    y: cell.row,
    shift: false,
    alt: false,
    ctrl: false,
  })
}

function emitSourceButton(
  source: ReturnType<typeof createFakeMouseEventSource>,
  type: 'press' | 'release',
  cell: { column: number; row: number },
): void {
  source.emit({
    type,
    button: 'left',
    x: cell.column,
    y: cell.row,
    shift: false,
    alt: false,
    ctrl: false,
  })
}

const listWheelTargets = [
  '07 / Themes · dark and light',
  '06 / Mouse · clicks and wheel',
  '05 / Focus · zones and groups',
  '04 / Process · child output',
  '03 / Workflow · guided steps',
  '02 / Controls · inputs and lists',
  '01 / Overview · route map',
]

function wheelDownInList(app: AppRender): void {
  const frame = frameText(app)
  const visibleRow = listWheelTargets.find((label) => frame.includes(label))
  if (!visibleRow) throw new Error('No visible List row to wheel over')
  wheelDownAtText(app, visibleRow)
}

function wheelDownInShell(app: AppRender): void {
  const frame = frameText(app)
  const visibleTarget = [
    'Keyboard focus:',
    'List activations:',
    'Hover + drag / app name in the top bar',
    'MouseArea / explicit caller bounds',
    'Live origin',
  ].find((target) => frame.includes(target))
  if (!visibleTarget) throw new Error('No visible shell content to wheel over')
  wheelDownAtText(app, visibleTarget)
}

async function pressUntilFrame(
  app: AppRender,
  key: string,
  expected: string,
  { attempts = 4, attemptTimeout = 3000 } = {},
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await settle()
    app.stdin.write(key)
    try {
      await waitForFrame(
        app,
        expected,
        attempt === attempts ? 15000 : attemptTimeout,
      )
      return
    } catch (error) {
      if (attempt === attempts) throw error
    }
  }
}

async function pressUntilFrameWithout(
  app: AppRender,
  key: string,
  unexpected: string,
  { attempts = 4, attemptTimeout = 3000 } = {},
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await settle()
    app.stdin.write(key)
    try {
      await waitForFrameWithout(
        app,
        unexpected,
        attempt === attempts ? 15000 : attemptTimeout,
      )
      return
    } catch (error) {
      if (attempt === attempts) throw error
    }
  }
}

/** Counts non-overlapping literal occurrences of `needle` in a frame. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

async function waitForOccurrences(
  app: AppRender,
  text: string,
  minimum: number,
  timeout = 3000,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(countOccurrences(frameText(app), text)).toBeGreaterThanOrEqual(
        minimum,
      )
    },
    { timeout, interval: 25 },
  )
}

/**
 * Maps a frame-text cell to the row a real terminal would display after Ink
 * writes a frame taller than the mocked terminal: the emulator keeps the
 * bottom `ttyRows` lines, so every frame row shifts up by the overflow. When
 * the frame fits, this is exactly `cellForText`. A click must land at the
 * visual row, not the Yoga/frame row, or measured hitboxes drift off target.
 */
function visualCellForText(
  app: AppRender,
  text: string,
  ttyRows: number,
): { column: number; row: number } {
  const cell = cellForText(app, text)
  const overflow = Math.max(0, frameRowCount(app) - ttyRows)
  return { column: cell.column, row: Math.max(0, cell.row - overflow) }
}

async function clickCell(
  app: AppRender,
  cell: { column: number; row: number },
): Promise<void> {
  sendSgrMouse(app, 0, cell)
  await settle()
  sendSgrMouse(app, 0, cell, true)
}

describe('ShowcaseApp package-consumer smoke', () => {
  it('renders the composed shell with the overview route', async () => {
    const app = renderApp()
    await waitForFrame(app, 'RUNEFRAME / FEATURE LAB')
    const frame = frameText(app)

    expect(frame).toContain('MAINTAINER BENCH')
    expect(frame).toContain('Public surface, in motion.')
    expect(frame).toContain('START / choose a track')
    expect(frame).toContain('Open control bench')

    // Sidebar navigation from the local screen registry.
    expect(frame).toContain('Overview')
    expect(frame).toContain('Controls')
    expect(frame).toContain('Workflow')
    expect(frame).toContain('Process')
    expect(frame).toContain('Input lab')

    // Status bar reflects theme + route from the framework providers.
    expect(frame).toContain('DARK / OVERVIEW')
  })

  it('accepts mouse routing diagnostics without changing the initial route', async () => {
    const events: MouseRoutingDiagnostic[] = []
    const app = render(
      <ShowcaseApp mouseDiagnostics={(event) => events.push(event)} />,
    )
    activeRenders.push(app)

    await waitForFrame(app, 'DARK / OVERVIEW')
    expect(frameText(app)).toContain('MAINTAINER BENCH')
    // No mouse packet was sent, so the opt-in sink stays silent.
    expect(events).toEqual([])
  })

  it('navigates to a feature screen with key input', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '1', 'CONTROL DESK')
    await waitForFrame(app, 'DARK / CONTROLS')
    expect(frameText(app)).toContain('TextInput / textinput scope')
  })

  it('keeps tabs reachable while TextInput suspends the shell, then resumes shell navigation after leaving the Text tab', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '1', 'CONTROL DESK')
    await waitForFrame(app, 'DARK / CONTROLS')
    await waitForFrame(app, 'TextInput / textinput scope')

    // ArrowRight must still reach Tabs while TextInput owns the textinput
    // scope and has suspended shell-level navigation.
    await pressUntilFrame(app, '\u001b[C', 'NumberInput / bounded value')
    await waitForFrame(app, 'Current value: 0 / 60')

    // Leaving the Text tab must restore shell navigation, so `b` pops the
    // Controls route back to Overview.
    await pressUntilFrame(app, 'b', 'MAINTAINER BENCH')
    await waitForFrame(app, 'DARK / OVERVIEW')
  })

  it('pops back to the previous route from a non-suspended screen', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await waitForFrame(app, 'INTERACTIONS')

    await pressUntilFrame(app, 'b', 'MAINTAINER BENCH')
    await waitForFrame(app, 'DARK / OVERVIEW')
  })

  it('opens the help modal and closes it with Escape', async () => {
    const app = renderApp()
    await waitForFrame(app, 'MAINTAINER BENCH')

    await pressUntilFrame(app, '?', 'Feature Lab / quick keys')
    await waitForFrame(app, 'Search the public shell actions')

    await pressUntilFrameWithout(app, '\u001b', 'Feature Lab / quick keys')
    expect(frameText(app)).toContain('MAINTAINER BENCH')
  })

  it('toggles the framework theme and raises a toast', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, 't', 'LIGHT / OVERVIEW')
    await pressUntilFrame(app, 't', 'DARK / OVERVIEW')
    await pressUntilFrame(app, 'f', 'Toast provider is live.')
  })

  it('switches shared theme tokens and keeps the nested preview override local', async () => {
    const app = renderApp()
    setTtyRows(app, 24)
    await waitForFrame(app, 'MAINTAINER BENCH')

    await clickText(app, 'Theme Studio')
    await waitForFrame(app, 'THEME STUDIO / TOKENS')
    await waitForFrame(app, 'palette: Cinder')
    await waitForFrame(app, 'local-focus / plum')
    await waitForFrame(app, 'inherits comfortable / signal')
    await waitForFrame(app, '[Preview action]')
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)

    // These controls update the FrameworkProvider's shared theme, while the
    // nested preview keeps its local focus override and inherits the rest. The
    // app starts with the historical square-bracket button symbols; Classic
    // switches both buttons and badges to angle brackets.
    await clickText(app, 'Tide')
    await waitForFrame(app, 'palette: Tide')
    await clickText(app, 'Compact')
    await waitForFrame(app, 'density: compact')
    await clickText(app, 'Classic')
    await waitForFrame(app, 'symbols: classic')
    await waitForFrame(app, 'inherits compact / classic')
    await waitForFrame(app, '<Preview action>')
    await waitForFrameWithout(app, '[Preview action]')

    await clickText(app, 'Preview action')
    await waitForFrame(app, 'Local preview action fired.')

    // The established dark/light shortcut remains available on the new route.
    await pressUntilFrame(app, 't', 'LIGHT / THEMES')
    await pressUntilFrame(app, 't', 'DARK / THEMES')
  })

  it('keeps the Interaction lab mouse button aligned with its visible row after toasts', async () => {
    const app = renderApp()
    setTtyRows(app, 24)
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    const arrowRight = '\u001b[C'
    await pressUntilFrame(app, arrowRight, 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, arrowRight, 'MouseLayout / measured targets')
    await waitForFrame(app, 'Button activations: 0')
    await settle(100)

    // Baseline: with no toast the frame fits the mocked terminal, so the
    // rendered row is the physical row and the click activates the button.
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)
    await clickText(app, '[Run mouse action]')
    await waitForFrame(app, 'Button activations: 1')

    // Toasts render above the fixed-height shell. One toast must not push the
    // frame past the mocked terminal height, or Ink scrolls the terminal and
    // every measured hitbox ends up one row below its visual target.
    await pressUntilFrame(app, 'f', 'Toast provider is live.')
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)

    // The button must stay clickable at the row where it is actually rendered.
    await clickCell(app, visualCellForText(app, '[Run mouse action]', 24))
    await waitForFrame(app, 'Button activations: 2')

    // Stacked toasts (up to the provider's visible cap) must stay inside the
    // same bound and keep the measured target aligned.
    app.stdin.write('f')
    await settle()
    app.stdin.write('f')
    await waitForOccurrences(app, 'Toast provider is live.', 3)
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)
    await clickCell(app, visualCellForText(app, '[Run mouse action]', 24))
    await waitForFrame(app, 'Button activations: 3')
  })

  it('uses clickable shell actions, route buttons and the command palette', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await clickText(app, 'Open control bench')
    await waitForFrame(app, 'DARK / CONTROLS')
    await clickText(app, 'Overview')
    await waitForFrame(app, 'DARK / OVERVIEW')
    await waitForFrame(app, 'Open control bench')
    await clickText(app, 'Open control bench')
    await waitForFrame(app, 'DARK / CONTROLS')
    await clickText(app, 'Back')
    await waitForFrame(app, 'DARK / OVERVIEW')

    await clickText(app, 'Help')
    await waitForFrame(app, 'Feature Lab / quick keys')
    await clickText(app, 'Close')
    await waitForFrame(app, 'DARK / OVERVIEW')

    await clickText(app, 'Commands')
    await waitForFrame(app, 'Click a command to run it')
    await clickText(app, 'Open workflow')
    await waitForFrame(app, 'WORKFLOW / 02')

    await clickText(app, 'Theme: Light')
    await waitForFrame(app, 'LIGHT / WORKFLOW')
    await clickText(app, 'Theme: Dark')
    await waitForFrame(app, 'DARK / WORKFLOW')
    await clickText(app, 'Home')
    await waitForFrame(app, 'DARK / OVERVIEW')
  })

  it('keeps the measured hover cue visible on feature routes outside the mouse lab', async () => {
    const events: MouseRoutingDiagnostic[] = []
    const source = createFakeMouseEventSource()
    const node = (
      <ShowcaseApp
        mouseDiagnostics={(event) => events.push(event)}
        mouseEventSource={source}
      />
    )
    const app = render(node)
    activeRenders.push(app)
    setTtyRows(app, 24, node)
    await waitForFrame(app, 'DARK / OVERVIEW')
    await waitForFrame(app, '○ hover')

    await pressUntilFrame(app, '2', 'WORKFLOW / 02')
    await waitForFrame(app, '○ hover')
    const brandCell = cellForText(app, 'RUNEFRAME / FEATURE LAB')
    emitSourceMove(source, 'none', brandCell)
    await waitForFrame(app, '● hover')

    expect(frameText(app)).toContain('WORKFLOW / 02')
    expect(
      events.some(
        (event) =>
          event.action === 'move' &&
          event.x === brandCell.column &&
          event.y === brandCell.row &&
          event.targetId !== null,
      ),
    ).toBe(true)
  })

  it('keeps keyboard search and activation in the command palette', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    app.stdin.write('\u0010') // Ctrl+P
    await waitForFrame(app, 'Click a command to run it')
    for (const character of 'open workflow') {
      app.stdin.write(character)
      await settle(15)
    }
    await waitForFrame(app, 'open workflow')
    await waitForFrame(app, 'Open workflow')
    await pressUntilFrame(app, '\r', 'WORKFLOW / 02')
    await waitForFrame(app, 'Choose a neutral test track')
  })

  it('selects a control with the mouse and activates the current selection', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')
    await clickText(app, 'Open control bench')
    await waitForFrame(app, 'CONTROL DESK')

    await clickText(app, 'Find')
    await waitForFrame(app, 'SearchInput + SelectableList')
    await clickText(app, 'Focus tree')
    await clickText(app, 'Open selected')
    await waitForFrame(app, 'Opened focus.')
  })

  it('selects and advances the workflow with the mouse, including cancel', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')
    await clickText(app, '02  Workflow · ChoicePrompt into StepFlow')
    await waitForFrame(app, 'Choose a neutral test track')

    await clickText(app, 'Cancel workflow')
    await waitForFrame(app, 'No workflow started.')
    await clickText(app, 'Process probe')
    await waitForFrame(app, 'StepFlow / shared step context')
    await waitForFrame(app, 'Current track: Process probe')

    await clickText(app, 'Next')
    await waitForFrame(app, '[2/3] Configure')
    await clickText(app, 'Next')
    await waitForFrame(app, '[3/3] Review')
    await clickText(app, 'Finish')
    await waitForFrame(app, 'Flow complete: Process probe.')
  })

  it('keeps route and shell actions clickable in a short layout', async () => {
    const app = renderApp()
    setTtyRows(app, 18)
    await waitForFrame(app, 'DARK / OVERVIEW')
    expect(frameText(app)).not.toContain('FIELD GUIDE')

    await clickText(app, 'Workflow')
    await waitForFrame(app, 'WORKFLOW / 02')
    await clickText(app, 'Home')
    await waitForFrame(app, 'DARK / OVERVIEW')
  })

  it('keeps every Interaction tab inside a short terminal with clickable navigation', async () => {
    const app = renderApp()
    setTtyRows(app, 18)
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')

    // Every Interaction tab must fit the mocked terminal; a taller tab makes
    // Ink scroll and leaves the tab row and hitboxes misaligned.
    const arrowRight = '\u001b[C'
    const interactionTabFrames = [
      { key: '', expected: 'FocusTree / zones + roving groups' },
      { key: arrowRight, expected: 'EventTracer + KeyboardDebugInspector' },
      { key: arrowRight, expected: 'MouseLayout / measured targets' },
      { key: arrowRight, expected: 'Experimental / explicitly labeled' },
    ]
    for (const tab of interactionTabFrames) {
      if (tab.key) await pressUntilFrame(app, tab.key, tab.expected)
      await waitForFrame(app, tab.expected)
      expect(frameRowCount(app)).toBeLessThanOrEqual(18)
    }

    // Tab and route navigation must remain clickable after the tab cycle.
    await clickText(app, 'Focus tree')
    await waitForFrame(app, 'FocusTree / zones + roving groups')
    await clickText(app, 'Home')
    await waitForFrame(app, 'DARK / OVERVIEW')
  })

  it('drives the ChoicePrompt -> StepFlow selection flow to completion', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '2', 'WORKFLOW / 02')
    await waitForFrame(app, 'Choose a neutral test track')

    await pressUntilFrame(app, 'a', 'StepFlow / shared step context')
    await waitForFrame(app, '[1/3] Inspect')
    expect(frameText(app)).toContain('Current track: Read-only check')

    await pressUntilFrame(app, '\r', '[2/3] Configure')
    await pressUntilFrame(app, '\r', '[3/3] Review')
    await pressUntilFrame(app, '\r', 'Flow complete: Read-only check.')
  })

  it('runs a real child process and surfaces stdout, stderr and exit status', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '3', 'PROCESS / 03')
    await waitForFrame(app, '[r] run  [c] stop')

    await pressUntilFrame(app, 'r', 'stdout / probe started', {
      attemptTimeout: 5000,
    })
    await waitForFrame(app, 'stderr / sample warning', 20000)
    await waitForFrame(app, 'stdout / probe finished', 20000)
    await waitForFrame(app, 'COMPLETE', 20000)
    await waitForFrame(app, 'exit 0', 20000)
  })

  it('fits the Mouse tab on resize and routes synthetic SGR to visible controls', async () => {
    const app = renderApp()
    const enableWrite = vi.spyOn(app.stdout, 'write')
    setTtyRows(app, 24)
    await waitForFrame(app, 'DARK / OVERVIEW')
    await vi.waitFor(
      () => {
        expect(
          enableWrite.mock.calls.some(([frame]) =>
            frame.includes('\u001b[?1003h\u001b[?1006h'),
          ),
        ).toBe(true)
      },
      { timeout: 3000, interval: 25 },
    )

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    const arrowRight = String.fromCharCode(27) + '[C'
    await pressUntilFrame(app, arrowRight, 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, arrowRight, 'MouseLayout / measured targets')
    await waitForFrame(app, 'Button activations: 0')
    await waitForFrame(app, 'Keyboard focus: 01 / Overview')
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)
    expect(frameText(app)).toContain('RUNEFRAME / FEATURE LAB')
    expect(frameText(app)).toContain('DARK / INTERACTIONS')
    expect(frameText(app)).toContain('FIELD GUIDE')
    expect(cellForText(app, '[Run mouse action]').column).toBeGreaterThan(20)

    // The auto-registered button remains aligned inside the measured shell
    // content when both the sidebar and fixed shell bars are present.
    await clickText(app, '[Run mouse action]')
    await waitForFrame(app, 'Button activations: 1')

    // First prove that wheel input reaches the List itself.
    wheelDownAtText(app, '01 / Overview')
    await waitForFrame(app, '04 / Process · child output')

    expect(frameText(app)).toContain('Keyboard focus: 01 / Overview · route map')
    expect(frameText(app)).toContain('Button activations: 1')

    for (let step = 0; step < 3; step++) {
      wheelDownInList(app)
      await settle()
    }
    const atListEnd = frameText(app)
    expect(atListEnd).toContain('07 / Themes · dark and light')
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)

    // The List cannot consume another down-wheel at its end. With overflowing
    // content, the fixed-sidebar shell viewport must then move while its bars
    // and sidebar stay anchored.
    wheelDownInList(app)
    await vi.waitFor(
      () => expect(frameText(app)).not.toBe(atListEnd),
      { timeout: 3000, interval: 25 },
    )
    const afterBoundaryWheel = frameText(app)
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)
    expect(afterBoundaryWheel).toContain('RUNEFRAME / FEATURE LAB')
    expect(afterBoundaryWheel).toContain('DARK / INTERACTIONS')
    expect(afterBoundaryWheel).toContain('FIELD GUIDE')
    expect(afterBoundaryWheel).toContain('07 / Themes · dark and light')

    // Both automatic targets follow their visible positions after the shell
    // scroll; the row selects without activating the List item.
    await clickText(app, '[Run mouse action]')
    await waitForFrame(app, 'Button activations: 2')
    await clickText(app, '07 / Themes · dark and light')
    await waitForFrame(app, 'Keyboard focus: 07 / Themes · dark and light')
    expect(frameText(app)).toContain('List activations: 0')
    expect(frameText(app)).toContain('Button activations: 2')

    // At short heights the Mouse tab returns to its compact normal-flow
    // layout; the real rendered frame still fits the terminal.
    setTtyRows(app, 18)
    await waitForFrame(app, 'INPUT LAB / 04 · MOUSE CONTRACT')
    await vi.waitFor(
      () => expect(frameRowCount(app)).toBeLessThanOrEqual(18),
      { timeout: 3000, interval: 25 },
    )
    expect(frameText(app)).not.toContain('FIELD GUIDE')
    expect(frameText(app)).toContain('RUNEFRAME / FEATURE LAB')

    setTtyRows(app, 40)
    await vi.waitFor(
      () => expect(frameRowCount(app)).toBeLessThanOrEqual(40),
      { timeout: 3000, interval: 25 },
    )
    expect(frameText(app)).toContain('RUNEFRAME / FEATURE LAB')
    expect(frameText(app)).toContain('DARK / INTERACTIONS')
    expect(frameText(app)).toContain('FIELD GUIDE')
  })

  it('shows hover feedback on the selected and focused Mouse List row without activating it', () =>
    withColorOutput(async () => {
      const source = createFakeMouseEventSource()
      const node = <ShowcaseApp mouseEventSource={source} />
      const app = render(node)
      activeRenders.push(app)
      app.stdout.setMaxListeners(0)
      setTtyRows(app, 40, node)
      await waitForFrame(app, 'DARK / OVERVIEW')

      await pressUntilFrame(app, '4', 'INPUT LAB / 04')
      await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
      await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
      await waitForFrame(app, 'Keyboard focus: 01 / Overview · route map')

      const selectedRow = '01 / Overview · route map'
      const cell = cellForText(app, selectedRow)
      const beforeHover = app.lastFrame() ?? ''
      emitSourceMove(source, 'none', cell)
      await settle()

      const afterHover = app.lastFrame() ?? ''
      expect(afterHover).not.toBe(beforeHover)
      expect(afterHover).toContain('\u001b[4m')
      expect(frameText(app)).toContain('Keyboard focus: 01 / Overview · route map')
      expect(frameText(app)).toContain('List activations: 0')
    }),
  )

  it('resets brand hover when a toast moves the measured target, then tracks its new row', async () => {
    const source = createFakeMouseEventSource()
    const node = <ShowcaseApp mouseEventSource={source} />
    const app = render(node)
    activeRenders.push(app)
    app.stdout.setMaxListeners(0)
    setTtyRows(app, 24, node)
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await waitForFrame(app, 'Hover + drag / app name in the top bar')

    const brand = 'RUNEFRAME / FEATURE LAB'
    const originalCell = cellForText(app, brand)
    emitSourceMove(source, 'none', originalCell)
    await waitForFrame(
      app,
      `Pointer over app name at ${originalCell.column}, ${originalCell.row}.`,
    )
    await waitForFrame(app, '● hover')

    await pressUntilFrame(app, 'f', 'Toast provider is live.')
    await waitForFrame(app, 'Move over the app name above to test hover.')
    expect(frameText(app)).toContain('○ hover')

    const shiftedCell = cellForText(app, brand)
    expect(shiftedCell.row).toBe(originalCell.row + 1)
    emitSourceMove(source, 'none', shiftedCell)
    await waitForFrame(
      app,
      `Pointer over app name at ${shiftedCell.column}, ${shiftedCell.row}.`,
    )
    await waitForFrame(app, '● hover')
  })

  it('describes terminal and Windows mouse input accurately', async () => {
    const app = renderApp()
    setTtyRows(app, 40)
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await waitForFrame(app, 'Terminal mouse reports use SGR')

    expect(frameText(app)).toContain('Windows host normalizes native events.')
  })

  it('reports Mouse contract click geometry through routing diagnostics', async () => {
    const events: MouseRoutingDiagnostic[] = []
    const sink = (event: MouseRoutingDiagnostic): void => {
      events.push(event)
    }
    const app = render(<ShowcaseApp mouseDiagnostics={sink} />)
    activeRenders.push(app)
    // Many measured Ink nodes subscribe to this one test stream; the fan-out
    // is expected, so keep it from tripping Node's leak warning threshold.
    app.stdout.setMaxListeners(0)
    setTtyRows(app, 24, <ShowcaseApp mouseDiagnostics={sink} />)
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await waitForFrame(app, 'Button activations: 0')
    await settle(100)

    // Click the visible button center. The press/release diagnostics must
    // resolve the target whose measured bounds contain that exact cell.
    const buttonCell = cellForText(app, '[Run mouse action]')
    sendSgrMouse(app, 0, buttonCell)
    await settle()
    sendSgrMouse(app, 0, buttonCell, true)
    await waitForFrame(app, 'Button activations: 1')

    const press = events.find(
      (event) =>
        event.action === 'press' &&
        event.x === buttonCell.column &&
        event.y === buttonCell.row,
    )
    expect(press).toBeDefined()
    expect(press!.reason).toBe('press-pending')
    expect(press!.targetId).not.toBeNull()
    expect(press!.registeredCount).toBeGreaterThanOrEqual(1)
    expect(press!.eligibleCount).toBeGreaterThanOrEqual(1)
    expect(press!.containingCount).toBeGreaterThanOrEqual(1)

    const release = events.find(
      (event) =>
        event.action === 'release' &&
        event.x === buttonCell.column &&
        event.y === buttonCell.row,
    )
    expect(release).toMatchObject({
      reason: 'dispatched',
      dispatched: true,
      targetId: press!.targetId,
      pressedTargetId: press!.targetId,
    })
    const target = release!.areas.find((area) => area.id === release!.targetId)
    expect(target).toBeDefined()
    expect(target).toMatchObject({ contains: true, eligible: true, hasHandler: true })
    // The diagnostic geometry is the zero-based half-open rectangle around
    // the clicked cell, not a stale or unmeasured placeholder.
    expect(target!.bounds.x).toBeLessThanOrEqual(buttonCell.column)
    expect(target!.bounds.x + target!.bounds.width).toBeGreaterThan(buttonCell.column)
    expect(target!.bounds.y).toBeLessThanOrEqual(buttonCell.row)
    expect(target!.bounds.y + target!.bounds.height).toBeGreaterThan(buttonCell.row)

    // One cell past the button's half-open right edge, same row: geometry says
    // no target, so the click is consumed without activating anything.
    const outsideCell = {
      column: target!.bounds.x + target!.bounds.width,
      row: buttonCell.row,
    }
    sendSgrMouse(app, 0, outsideCell)
    await settle()
    sendSgrMouse(app, 0, outsideCell, true)
    await settle()

    const outsidePress = events.find(
      (event) =>
        event.action === 'press' &&
        event.x === outsideCell.column &&
        event.y === outsideCell.row,
    )
    expect(outsidePress).toBeDefined()
    expect(outsidePress).toMatchObject({
      reason: 'no-target',
      targetId: null,
      containingCount: 0,
      dispatched: false,
    })
    expect(frameText(app)).toContain('Button activations: 1')
  })

  it('routes a provided mouse event source and disables the post-Ink interceptor', async () => {
    const events: MouseRoutingDiagnostic[] = []
    const source = createFakeMouseEventSource()
    const node = (
      <ShowcaseApp
        mouseDiagnostics={(event) => events.push(event)}
        mouseEventSource={source}
      />
    )
    const app = render(node)
    activeRenders.push(app)
    // Many measured Ink nodes subscribe to this one test stream; the fan-out
    // is expected, so keep it from tripping Node's leak warning threshold.
    app.stdout.setMaxListeners(0)
    setTtyRows(app, 24, node)
    await waitForFrame(app, 'DARK / OVERVIEW')

    // Keyboard input keeps flowing through Ink on this lane.
    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await waitForFrame(app, 'Button activations: 0')
    await settle(100)

    // Click the visible button through the external source only.
    const buttonCell = cellForText(app, '[Run mouse action]')
    source.emit({
      type: 'press',
      button: 'left',
      x: buttonCell.column,
      y: buttonCell.row,
      shift: false,
      alt: false,
      ctrl: false,
    })
    await settle()
    source.emit({
      type: 'release',
      button: 'left',
      x: buttonCell.column,
      y: buttonCell.row,
      shift: false,
      alt: false,
      ctrl: false,
    })
    await waitForFrame(app, 'Button activations: 1')

    const release = events.find(
      (event) =>
        event.action === 'release' &&
        event.x === buttonCell.column &&
        event.y === buttonCell.row,
    )
    expect(release).toMatchObject({ reason: 'dispatched', dispatched: true })
    expect(release!.targetId).not.toBeNull()

    // Wheel through the source over a visible List row.
    const listRow = listWheelTargets.find((label) =>
      frameText(app).includes(label),
    )
    if (!listRow) throw new Error('No visible List row to wheel over')
    const beforeWheel = frameText(app)
    const listCell = cellForText(app, listRow)
    source.emit({
      type: 'wheel',
      direction: 'down',
      x: listCell.column,
      y: listCell.row,
      shift: false,
      alt: false,
      ctrl: false,
    })
    await vi.waitFor(
      () => expect(frameText(app)).not.toBe(beforeWheel),
      { timeout: 3000, interval: 25 },
    )
    expect(
      events.some((event) => event.action === 'wheel-down' && event.dispatched),
    ).toBe(true)

    // A raw SGR packet on Ink's stdin must not dispatch anything: the legacy
    // post-Ink interceptor stays disabled while the source owns routing.
    const diagnosticsBefore = events.length
    sendSgrMouse(app, 0, buttonCell)
    await settle()
    sendSgrMouse(app, 0, buttonCell, true)
    await settle()
    expect(frameText(app)).toContain('Button activations: 1')
    expect(events.length).toBe(diagnosticsBefore)
  })

  it('routes measured hover, drag completion and cancellation from the public event source', async () => {
    const events: MouseRoutingDiagnostic[] = []
    const source = createFakeMouseEventSource()
    const node = (
      <ShowcaseApp
        mouseDiagnostics={(event) => events.push(event)}
        mouseEventSource={source}
      />
    )
    const app = render(node)
    activeRenders.push(app)
    app.stdout.setMaxListeners(0)
    setTtyRows(app, 24, node)
    await waitForFrame(app, 'DARK / OVERVIEW')
    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await waitForFrame(app, 'Hover + drag / app name in the top bar')

    const brand = 'RUNEFRAME / FEATURE LAB'
    const brandCell = cellForText(app, brand)
    emitSourceMove(source, 'none', brandCell)
    await waitForFrame(
      app,
      `Pointer over app name at ${brandCell.column}, ${brandCell.row}.`,
    )

    const hover = events.find(
      (event) =>
        event.action === 'move' &&
        event.x === brandCell.column &&
        event.y === brandCell.row &&
        event.targetId !== null,
    )
    expect(hover).toBeDefined()
    const measuredBrand = hover!.areas.find((area) => area.id === hover!.targetId)
    expect(measuredBrand?.bounds).toEqual({
      x: 0,
      y: 0,
      width: brand.length,
      height: 1,
    })

    const outsideBrand = { column: brand.length + 2, row: brandCell.row }
    emitSourceMove(source, 'none', outsideBrand)
    await waitForFrame(
      app,
      `Pointer left at ${outsideBrand.column}, ${outsideBrand.row}.`,
    )

    // The press cell becomes the drag origin; motion outside the measured box
    // still reaches the captured area, and release finishes rather than clicks.
    emitSourceButton(source, 'press', brandCell)
    const firstDragCell = {
      column: brandCell.column + 1,
      row: brandCell.row,
    }
    emitSourceMove(source, 'left', firstDragCell)
    await waitForFrame(
      app,
      `Dragging ${brandCell.column}, ${brandCell.row} → ${firstDragCell.column}, ${firstDragCell.row}.`,
    )
    emitSourceMove(source, 'left', outsideBrand)
    await waitForFrame(
      app,
      `Dragging ${brandCell.column}, ${brandCell.row} → ${outsideBrand.column}, ${outsideBrand.row}.`,
    )
    emitSourceButton(source, 'release', outsideBrand)
    await waitForFrame(
      app,
      `Drag ended at ${outsideBrand.column}, ${outsideBrand.row} from ${brandCell.column}, ${brandCell.row}.`,
    )

    // Replacing the input source is a supported cancellation path while the
    // measured area remains mounted and registered.
    emitSourceButton(source, 'press', brandCell)
    emitSourceMove(source, 'left', firstDragCell)
    await waitForFrame(app, 'Dragging')
    const replacementSource = createFakeMouseEventSource()
    app.rerender(
      <ShowcaseApp
        mouseDiagnostics={(event) => events.push(event)}
        mouseEventSource={replacementSource}
      />,
    )
    await waitForFrame(
      app,
      `Drag cancelled at ${firstDragCell.column}, ${firstDragCell.row} from ${brandCell.column}, ${brandCell.row}.`,
    )
    expect(events.some((event) => event.reason === 'drag-start')).toBe(true)
    expect(events.some((event) => event.reason === 'drag-end')).toBe(true)
  })

  it('shows measured hover and drag feedback over the rendered app name', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    const arrowRight = '\u001b[C'
    await pressUntilFrame(app, arrowRight, 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, arrowRight, 'MouseLayout / measured targets')

    const frame = frameText(app)
    expect(frame).toContain('RUNEFRAME / FEATURE LAB')
    expect(frame).toContain('DARK / INTERACTIONS')
    expect(frameRowCount(app)).toBeLessThanOrEqual(24)
    expect(frame).toContain('Hover + drag / app name in the top bar')
    expect(frame).toContain('MouseLayout / measured targets')
    expect(frame).toContain('Scrollable List / 7 rows')
  })

  it('renders the experimental subpath demo', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseLayout / measured targets')
    await pressUntilFrame(app, '\u001b[C', 'Experimental / explicitly labeled')
    expect(frameText(app)).toContain('KeyboardRegistry is experimental metadata')
  })
})
