import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { Box, Text } from 'ink'
import React, { type ReactElement } from 'react'
import chalk from 'chalk'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { ProcessOutputPanel } from './ProcessOutputPanel.js'
import type { ThemeOverrides } from '../../types.js'
import {
  useAsyncSession,
  type UseAsyncSessionResult,
} from '../process/useAsyncSession.js'
import type { SessionEvent } from '../process/AsyncSessionRunner.js'
import type { ProcessRunner, RunningProcess } from '../process/ProcessRunner.js'

// ── Mock Process Runner ──

class MockRunningProcess implements RunningProcess {
  private stdoutListeners = new Set<(data: string) => void>()
  private stderrListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(code: number | null) => void>()

  stdinData: string[] = []
  wasKilled = false

  sendStdin(data: string): void {
    this.stdinData.push(data)
  }

  kill(): void {
    this.wasKilled = true
  }

  onStdout(cb: (data: string) => void): () => void {
    this.stdoutListeners.add(cb)
    return () => this.stdoutListeners.delete(cb)
  }

  onStderr(cb: (data: string) => void): () => void {
    this.stderrListeners.add(cb)
    return () => this.stderrListeners.delete(cb)
  }

  onExit(cb: (code: number | null) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  emitStdout(data: string): void {
    for (const cb of this.stdoutListeners) cb(data)
  }

  emitStderr(data: string): void {
    for (const cb of this.stderrListeners) cb(data)
  }

  emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code)
  }
}

let lastMockProcess: MockRunningProcess | null = null

function createMockRunner(): ProcessRunner {
  return {
    spawn(_command: string): RunningProcess {
      const proc = new MockRunningProcess()
      lastMockProcess = proc
      return proc
    },
  }
}

// ── Helpers ──

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

function renderConsole(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function renderWithTheme(theme: ThemeOverrides, ui: ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

function stdoutEvent(data: string): SessionEvent {
  return { type: 'stdout', data, timestamp: 0 }
}

function stderrEvent(data: string): SessionEvent {
  return { type: 'stderr', data, timestamp: 0 }
}

function exitEvent(code: number | null): SessionEvent {
  return {
    type: 'exit',
    data: code === null ? '' : String(code),
    timestamp: 0,
    exitCode: code,
  }
}

// ── Console Harness ──

type ConsoleMode = 'browse' | 'command' | 'stdin'

interface ConsoleApi {
  session: UseAsyncSessionResult
  mode: ConsoleMode
  input: string
  activeCommand: string | null
  setInput: (value: string) => void
  beginCommand: () => void
  submit: () => void
  cancel: () => void
}

interface ConsoleHarnessProps {
  onSession?: (api: ConsoleApi) => void
  showPanel?: boolean
}

function ConsoleHarness({ onSession, showPanel = true }: ConsoleHarnessProps) {
  const [runner] = React.useState(createMockRunner)
  const session = useAsyncSession({ runner })
  const [mode, setMode] = React.useState<ConsoleMode>('browse')
  const [input, setInput] = React.useState('')
  const [activeCommand, setActiveCommand] = React.useState<string | null>(null)

  // Refs stay synchronous with state so the exposed API never acts on a
  // stale closure (mirrors how an interactive console reads current input).
  const modeRef = React.useRef<ConsoleMode>('browse')
  const inputRef = React.useRef('')

  const changeMode = (next: ConsoleMode) => {
    modeRef.current = next
    setMode(next)
  }

  const updateInput = (value: string) => {
    inputRef.current = value
    setInput(value)
  }

  const beginCommand = () => {
    changeMode('command')
    updateInput('')
  }

  const submit = () => {
    const currentMode = modeRef.current
    const value = inputRef.current

    if (currentMode === 'stdin') {
      session.sendInput(value + '\n')
      updateInput('')
      return
    }

    const command = value.trim()
    if (!command) return

    setActiveCommand(command)
    session.start(command)
    changeMode('stdin')
    updateInput('')
  }

  const cancel = () => {
    session.cancel()
    changeMode('browse')
    setActiveCommand(null)
  }

  onSession?.({
    session,
    mode,
    input,
    activeCommand,
    setInput: updateInput,
    beginCommand,
    submit,
    cancel,
  })

  return (
    <Box flexDirection="column">
      <Text>Mode:{mode}</Text>
      <Text>Status:{session.status}</Text>
      {showPanel && (
        <ProcessOutputPanel
          events={session.events}
          status={session.status}
          activeCommand={activeCommand}
        />
      )}
    </Box>
  )
}

/// Helper: open the command prompt and type text, then wait for render
async function beginAndType(api: ConsoleApi, text: string) {
  api.beginCommand()
  api.setInput(text)
  await delay()
}

/// Helper: spawn a command via the API (begin + type + submit)
async function spawnCommand(api: ConsoleApi, cmd: string) {
  api.beginCommand()
  api.setInput(cmd)
  await delay()
  api.submit()
  await delay()
}

// ── ProcessOutputPanel Tests ──

describe('ProcessOutputPanel', () => {
  it('shows idle status by default', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel events={[]} status="idle" activeCommand={null} />,
    )
    expect(lastFrame()).toContain('Idle')
  })

  it('shows running status', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={[]}
        status="running"
        activeCommand="echo test"
      />,
    )
    expect(lastFrame()).toContain('Running')
    expect(lastFrame()).toContain('echo test')
  })

  it('shows complete status with exit code', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={[exitEvent(0)]}
        status="complete"
        activeCommand="ls"
      />,
    )
    expect(lastFrame()).toContain('Complete')
    expect(lastFrame()).toContain('exit 0')
  })

  it('shows error status with non-zero exit code', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={[exitEvent(1)]}
        status="error"
        activeCommand="bad-command"
      />,
    )
    expect(lastFrame()).toContain('Error')
    expect(lastFrame()).toContain('exit 1')
  })

  it('renders stdout output lines', () => {
    const events = [stdoutEvent('line one'), stdoutEvent('line two')]
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={events}
        status="running"
        activeCommand="echo"
      />,
    )
    const frame = lastFrame()
    expect(frame).toContain('line one')
    expect(frame).toContain('line two')
  })

  it('renders stderr output lines', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={[stderrEvent('error message')]}
        status="running"
        activeCommand="cmd"
      />,
    )
    expect(lastFrame()).toContain('error message')
  })

  it('ignores non-output events when rendering lines', () => {
    const events: SessionEvent[] = [
      { type: 'status', data: 'running', timestamp: 0 },
      stdoutEvent('real output'),
    ]
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={events}
        status="running"
        activeCommand="cmd"
      />,
    )
    expect(lastFrame()).toContain('real output')
    expect(lastFrame()).not.toContain('status')
  })

  it('shows waiting message while running with no output', () => {
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={[]}
        status="running"
        activeCommand="sleep"
      />,
    )
    expect(lastFrame()).toContain('Waiting for output')
  })

  it('drops older lines beyond maxVisibleLines', () => {
    const events = [
      stdoutEvent('old line'),
      stdoutEvent('middle line'),
      stdoutEvent('new line'),
    ]
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={events}
        status="complete"
        activeCommand="cmd"
        maxVisibleLines={2}
      />,
    )
    const frame = lastFrame()
    expect(frame).not.toContain('old line')
    expect(frame).toContain('middle line')
    expect(frame).toContain('new line')
  })
})

// ── useAsyncSession Integration Tests ──

describe('useAsyncSession console flow', () => {
  beforeEach(() => {
    lastMockProcess = null
  })

  it('starts in browse mode and idle status', async () => {
    const { lastFrame } = renderConsole(<ConsoleHarness />)
    expect(lastFrame()).toContain('Mode:browse')
    expect(lastFrame()).toContain('Status:idle')
  })

  it('beginCommand switches to command mode', async () => {
    let api!: ConsoleApi
    const { lastFrame } = renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    api.beginCommand()
    await delay()

    expect(lastFrame()).toContain('Mode:command')
  })

  it('accepts input in command mode', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await beginAndType(api, 'echo hello')
    expect(api.input).toBe('echo hello')
  })

  it('submit spawns process and switches to stdin mode', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'echo hello')

    expect(api.mode).toBe('stdin')
    expect(api.session.status).toBe('running')
    expect(api.activeCommand).toBe('echo hello')
  })

  it('submitting empty input in command mode does nothing', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    api.beginCommand()
    await delay()
    api.submit()
    await delay()

    expect(api.mode).toBe('command')
    expect(api.session.status).toBe('idle')
  })

  it('accumulates stdout output from process', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'echo hello')

    expect(lastMockProcess).not.toBeNull()
    lastMockProcess!.emitStdout('hello\n')
    await delay()

    expect(api.session.output.length).toBe(1)
    expect(api.session.output[0]!.data).toBe('hello\n')
    expect(api.session.output[0]!.type).toBe('stdout')
  })

  it('accumulates stderr output from process', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'cmd')

    lastMockProcess!.emitStderr('error\n')
    await delay()

    expect(api.session.output.length).toBe(1)
    expect(api.session.output[0]!.type).toBe('stderr')
  })

  it('sends stdin via submit in stdin mode', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'cat')

    api.setInput('some input')
    await delay()
    api.submit()
    await delay()

    expect(lastMockProcess!.stdinData).toContain('some input\n')
  })

  it('empty submit sends newline in stdin mode', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'cat')

    api.submit()
    await delay()

    expect(lastMockProcess!.stdinData).toContain('\n')
  })

  it('cancel terminates the process and returns to browse', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'sleep 10')

    expect(api.mode).toBe('stdin')
    expect(api.session.status).toBe('running')

    api.cancel()
    await delay()

    expect(lastMockProcess!.wasKilled).toBe(true)
    expect(api.mode).toBe('browse')
    expect(api.session.status).toBe('idle')
  })

  it('process exit transitions status to complete and shows the exit code', async () => {
    let api!: ConsoleApi
    const { lastFrame } = renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'echo')

    expect(api.session.status).toBe('running')

    lastMockProcess!.emitExit(0)
    await delay()

    expect(api.session.status).toBe('complete')
    expect(api.session.exitCode).toBe(0)
    expect(api.mode).toBe('stdin')
    expect(lastFrame()).toContain('exit 0')
  })

  it('non-zero exit transitions status to error', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'exit 1')

    lastMockProcess!.emitExit(1)
    await delay()

    expect(api.session.status).toBe('error')
    expect(api.session.exitCode).toBe(1)
  })

  it('handles multiple spawns sequentially', async () => {
    let api!: ConsoleApi
    renderConsole(
      <ConsoleHarness
        onSession={(s) => {
          api = s
        }}
      />,
    )
    await delay()

    await spawnCommand(api, 'echo first')
    lastMockProcess!.emitExit(0)
    await delay()
    expect(api.activeCommand).toBe('echo first')

    api.beginCommand()
    api.setInput('echo second')
    await delay()
    api.submit()
    await delay()

    expect(api.activeCommand).toBe('echo second')
    expect(api.session.status).toBe('running')
    expect(api.session.events.filter((e) => e.type === 'stdout')).toHaveLength(0)
  })
})

// ── SessionEvent Rendering Tests ──

describe('SessionEvent rendering', () => {
  it('renders multiple output lines in order', () => {
    const events = [
      stdoutEvent('first'),
      stdoutEvent('second'),
      stdoutEvent('third'),
    ]

    const { lastFrame } = renderConsole(
      <ProcessOutputPanel
        events={events}
        status="complete"
        activeCommand="test"
      />,
    )

    const frame = lastFrame() ?? ''
    const firstIdx = frame.indexOf('first')
    const secondIdx = frame.indexOf('second')
    const thirdIdx = frame.indexOf('third')

    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(thirdIdx).toBeGreaterThan(secondIdx)
  })
})

// ── Theme Integration Tests ──

describe('ProcessOutputPanel theme integration', () => {
  it('applies global status colors', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      { colors: { status: { warning: 'magenta' } } },
      <ProcessOutputPanel events={[]} status="starting" activeCommand={null} />,
    )
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('maps idle status to the global secondary text color', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      { colors: { text: { secondary: 'magenta' } } },
      <ProcessOutputPanel events={[]} status="idle" activeCommand={null} />,
    )
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('lets component colors override global status colors', () => {
    chalk.level = 1
    const { lastFrame } = renderWithTheme(
      {
        colors: { status: { success: 'magenta' } },
        components: { processOutputPanel: { colors: { running: 'green' } } },
      },
      <ProcessOutputPanel events={[]} status="running" activeCommand="cmd" />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u001B[32m')
    expect(frame).not.toContain('\u001B[35m')
  })

  it('keeps the historical status colors without a theme', () => {
    chalk.level = 1
    const { lastFrame } = renderConsole(
      <ProcessOutputPanel events={[]} status="running" activeCommand="cmd" />,
    )
    expect(lastFrame()).toContain('\u001B[32m')
  })
})
