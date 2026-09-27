import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
// The app is imported from its local source; every framework API it uses is
// resolved from the installed `runeframe@0.5.0` package.
import { ShowcaseApp } from '../src/App.js'

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

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g

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

describe('ShowcaseApp package-consumer smoke', () => {
  it('renders the composed shell with the overview route', async () => {
    const app = renderApp()
    await waitForFrame(app, 'RUNEFRAME / FEATURE LAB')
    const frame = frameText(app)

    expect(frame).toContain('MAINTAINER BENCH')
    expect(frame).toContain('Public surface, in motion.')
    expect(frame).toContain('START / choose a track')
    expect(frame).toContain('Open control bench')

    // Sidebar navigation from the installed screen registry.
    expect(frame).toContain('Overview')
    expect(frame).toContain('Controls')
    expect(frame).toContain('Workflow')
    expect(frame).toContain('Process')
    expect(frame).toContain('Input lab')

    // Status bar reflects theme + route from the framework providers.
    expect(frame).toContain('DARK / OVERVIEW')
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

  it('documents the explicit mouse contract instead of claiming emulator support', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseArea / caller-owned geometry')

    const frame = frameText(app)
    expect(frame).toContain('demo target')
    expect(frame).toContain('No automatic Ink layout hit testing.')
    expect(frame).toContain('No hover, drag, or wheel events.')
    expect(frame).toContain(
      'This app makes no terminal-emulator compatibility claim.',
    )
  })

  it('renders the experimental subpath demo', async () => {
    const app = renderApp()
    await waitForFrame(app, 'DARK / OVERVIEW')

    await pressUntilFrame(app, '4', 'INPUT LAB / 04')
    await pressUntilFrame(app, '\u001b[C', 'EventTracer + KeyboardDebugInspector')
    await pressUntilFrame(app, '\u001b[C', 'MouseArea / caller-owned geometry')
    await pressUntilFrame(app, '\u001b[C', 'Experimental / explicitly labeled')
    expect(frameText(app)).toContain('KeyboardRegistry is experimental metadata')
  })
})
