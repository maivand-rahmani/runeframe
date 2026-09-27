import { describe, it, expect, vi } from 'vitest'
import { AsyncSessionRunner } from './AsyncSessionRunner.js'
import type { ProcessRunner, RunningProcess } from './ProcessRunner.js'
import type { SessionLifecycle } from './AsyncSessionRunner.js'

// ── Mock Helpers ──

interface MockProcess {
  process: RunningProcess
  killed: () => boolean
  emitStdout: (data: string) => void
  emitStderr: (data: string) => void
  emitExit: (code: number | null) => void
}

function createMockProcess(): MockProcess {
  let stdoutCb: ((data: string) => void) | null = null
  let stderrCb: ((data: string) => void) | null = null
  let exitCb: ((code: number | null) => void) | null = null
  let killed = false

  const process: RunningProcess = {
    sendStdin: vi.fn(),
    kill: vi.fn(() => {
      killed = true
    }),
    onStdout: vi.fn((cb: (data: string) => void) => {
      stdoutCb = cb
      return () => {
        stdoutCb = null
      }
    }),
    onStderr: vi.fn((cb: (data: string) => void) => {
      stderrCb = cb
      return () => {
        stderrCb = null
      }
    }),
    onExit: vi.fn((cb: (code: number | null) => void) => {
      exitCb = cb
      return () => {
        exitCb = null
      }
    }),
  }

  return {
    process,
    killed: () => killed,
    emitStdout(data: string) {
      stdoutCb?.(data)
    },
    emitStderr(data: string) {
      stderrCb?.(data)
    },
    emitExit(code: number | null) {
      exitCb?.(code)
    },
  }
}

function createMockRunner() {
  const processes: MockProcess[] = []

  const runner: ProcessRunner = {
    spawn: vi.fn((_command: string, _args?: string[]) => {
      const mock = createMockProcess()
      processes.push(mock)
      return mock.process
    }),
  }

  return {
    runner,
    processes,
    last(): MockProcess {
      const mock = processes[processes.length - 1]
      if (!mock) throw new Error('no process spawned')
      return mock
    },
  }
}

function noopLifecycle(): SessionLifecycle {
  return {
    onStatusChange: vi.fn(),
    onEvent: vi.fn(),
    onError: vi.fn(),
    onExit: vi.fn(),
  }
}

// ── Tests ──

describe('AsyncSessionRunner', () => {
  describe('start', () => {
    it('sets status to running after spawn', () => {
      const { runner } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello')

      expect(session.status).toBe('running')
      expect(session.isRunning()).toBe(true)
      expect(runner.spawn).toHaveBeenCalledWith('echo hello', undefined)
    })

    it('forwards args to the process runner verbatim', () => {
      const { runner } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('git', ['log', '--oneline'])

      expect(runner.spawn).toHaveBeenCalledWith('git', ['log', '--oneline'])
    })

    it('fires lifecycle onStatusChange for starting and running', () => {
      const { runner } = createMockRunner()
      const lifecycle = noopLifecycle()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello', undefined, lifecycle)

      expect(lifecycle.onStatusChange).toHaveBeenCalledWith('starting')
      expect(lifecycle.onStatusChange).toHaveBeenCalledWith('running')
    })

    it('pushes status events into the events array', () => {
      const { runner } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello')

      const statusEvents = session.events.filter((e) => e.type === 'status')
      expect(statusEvents).toHaveLength(2)
      expect(statusEvents[0]!.data).toBe('starting')
      expect(statusEvents[1]!.data).toBe('running')
    })

    it('captures stdout events', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello')
      last().emitStdout('hello world\n')

      expect(session.output).toHaveLength(1)
      expect(session.output[0]!.data).toBe('hello world\n')
      expect(session.output[0]!.type).toBe('stdout')
    })

    it('captures stderr events', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('invalid-cmd')
      last().emitStderr('command not found\n')

      expect(session.output).toHaveLength(1)
      expect(session.output[0]!.type).toBe('stderr')
    })

    it('transitions to complete on exit code 0', () => {
      const { runner, last } = createMockRunner()
      const lifecycle = noopLifecycle()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello', undefined, lifecycle)
      last().emitExit(0)

      expect(session.status).toBe('complete')
      expect(session.isRunning()).toBe(false)
      expect(session.exitCode).toBe(0)
      expect(lifecycle.onExit).toHaveBeenCalledWith(0)
    })

    it('emits an exit event carrying the exit code', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hello')
      last().emitExit(0)

      const exitEvent = session.events.find((e) => e.type === 'exit')
      expect(exitEvent).toBeDefined()
      expect(exitEvent!.data).toBe('0')
      expect(exitEvent!.exitCode).toBe(0)
    })

    it('transitions to error on non-zero exit code', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('exit 1')
      last().emitExit(1)

      expect(session.status).toBe('error')
      expect(session.isRunning()).toBe(false)
      expect(session.exitCode).toBe(1)
    })

    it('transitions to error and reports spawn failures', () => {
      const lifecycle = noopLifecycle()
      const session = new AsyncSessionRunner({
        runner: {
          spawn: vi.fn(() => {
            throw new Error('spawn ENOENT')
          }),
        },
      })

      session.start('missing-binary', undefined, lifecycle)

      expect(session.status).toBe('error')
      expect(lifecycle.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'spawn ENOENT' }),
      )
      expect(session.events.some((e) => e.type === 'error')).toBe(true)
    })

    it('kills the previous process when start is called again', () => {
      const { runner, processes } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('first')
      expect(processes[0]!.killed()).toBe(false)

      session.start('second')
      expect(processes[0]!.killed()).toBe(true)
      expect(processes).toHaveLength(2)
      expect(session.status).toBe('running')
    })

    it('ignores late events from a replaced process', () => {
      const { runner, processes } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('first')
      session.start('second')

      // The replaced process reports stdout/exit after replacement.
      processes[0]!.emitStdout('stale output\n')
      processes[0]!.emitExit(1)

      expect(session.status).toBe('running')
      expect(session.output).toHaveLength(0)
      expect(session.exitCode).toBeNull()
    })

    it('does not overwrite a synchronous exit with running', () => {
      const syncProcess: RunningProcess = {
        sendStdin: vi.fn(),
        kill: vi.fn(),
        onStdout: vi.fn(() => () => {}),
        onStderr: vi.fn(() => () => {}),
        onExit: vi.fn((cb: (code: number | null) => void) => {
          cb(0)
          return () => {}
        }),
      }
      const session = new AsyncSessionRunner({
        runner: { spawn: vi.fn(() => syncProcess) },
      })

      session.start('fast-exit')

      expect(session.status).toBe('complete')
      expect(session.exitCode).toBe(0)
    })

    it('resets events and exit code when starting a new run', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('first')
      last().emitStdout('done\n')
      last().emitExit(0)
      expect(session.events.length).toBeGreaterThan(0)

      session.start('second')

      expect(session.status).toBe('running')
      expect(session.exitCode).toBeNull()
      expect(session.events.filter((e) => e.type !== 'status')).toHaveLength(0)
    })
  })

  describe('sendInput', () => {
    it('writes to process stdin', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('cat')
      session.sendInput('hello stdin')

      expect(last().process.sendStdin).toHaveBeenCalledWith('hello stdin')
    })

    it('is a no-op when no process is running', () => {
      const session = new AsyncSessionRunner({
        runner: { spawn: vi.fn() },
      })

      expect(() => session.sendInput('data')).not.toThrow()
    })

    it('is a no-op after the process exits', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('cat')
      last().emitExit(0)
      session.sendInput('late input')

      expect(last().process.sendStdin).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('kills the process and sets status to idle', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('sleep 999')
      expect(session.status).toBe('running')

      session.cancel()

      expect(last().process.kill).toHaveBeenCalled()
      expect(session.status).toBe('idle')
      expect(session.isRunning()).toBe(false)
      expect(session.exitCode).toBeNull()
    })

    it('ignores exit events from a cancelled process', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('sleep 999')
      session.cancel()
      last().emitExit(0)

      expect(session.status).toBe('idle')
      expect(session.exitCode).toBeNull()
    })

    it('is a no-op when nothing is running', () => {
      const session = new AsyncSessionRunner({
        runner: { spawn: vi.fn() },
      })

      expect(() => session.cancel()).not.toThrow()
      expect(session.status).toBe('idle')
    })
  })

  describe('isRunning', () => {
    it('returns false after exit', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('echo hi')
      last().emitExit(0)

      expect(session.isRunning()).toBe(false)
    })
  })

  describe('output bounding', () => {
    it('drops oldest events when exceeding maxOutputLines', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner, maxOutputLines: 3 })

      session.start('long-command')
      last().emitStdout('line 1\n')
      last().emitStdout('line 2\n')
      last().emitStdout('line 3\n')
      last().emitStdout('line 4\n')

      expect(session.events).toHaveLength(3)
      const output = session.output.map((e) => e.data)
      expect(output).toEqual(['line 2\n', 'line 3\n', 'line 4\n'])
    })

    it('defaults to 500 when maxOutputLines is not provided', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('fill')
      for (let i = 0; i < 30; i++) {
        last().emitStdout(`line ${i}\n`)
      }

      expect(session.events.length).toBeLessThan(500)
      expect(session.events.length).toBeGreaterThan(0)
    })
  })

  describe('maxOutputLines validation', () => {
    const invalidLimits: Array<[string, number]> = [
      ['negative', -1],
      ['non-integer', 1.5],
      ['NaN', Number.NaN],
      ['positive infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
    ]

    it.each(invalidLimits)(
      'rejects a %s value synchronously with RangeError',
      (_label, value) => {
        expect(
          () =>
            new AsyncSessionRunner({ runner: { spawn: vi.fn() }, maxOutputLines: value }),
        ).toThrowError(RangeError)
        expect(
          () =>
            new AsyncSessionRunner({ runner: { spawn: vi.fn() }, maxOutputLines: value }),
        ).toThrowError(/maxOutputLines must be an integer >= 0/)
      },
    )

    it('accepts zero and retains no events', () => {
      const { runner, last } = createMockRunner()
      const lifecycle = noopLifecycle()
      const session = new AsyncSessionRunner({ runner, maxOutputLines: 0 })

      session.start('no-history', undefined, lifecycle)
      last().emitStdout('dropped stdout\n')
      last().emitStderr('dropped stderr\n')
      last().emitExit(0)

      expect(session.events).toHaveLength(0)
      expect(session.output).toHaveLength(0)
      // Terminal state still tracks the process even with no retained events.
      expect(session.status).toBe('complete')
      expect(session.exitCode).toBe(0)
      // Lifecycle callbacks still observe events even though none are retained.
      expect(lifecycle.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stdout', data: 'dropped stdout\n' }),
      )
      expect(lifecycle.onExit).toHaveBeenCalledWith(0)
    })
  })

  describe('cleanup', () => {
    it('kills the process and clears state', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('sleep 999')
      last().emitStdout('some output\n')

      expect(session.events.length).toBeGreaterThan(0)

      session.cleanup()

      expect(last().process.kill).toHaveBeenCalled()
      expect(session.events).toHaveLength(0)
      expect(session.status).toBe('idle')
      expect(session.exitCode).toBeNull()
    })

    it('does not emit status events or lifecycle callbacks', () => {
      const { runner } = createMockRunner()
      const lifecycle = noopLifecycle()
      const session = new AsyncSessionRunner({ runner })

      session.start('sleep 999', undefined, lifecycle)
      session.cleanup()

      expect(lifecycle.onStatusChange).not.toHaveBeenCalledWith('idle')
      expect(lifecycle.onEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'status', data: 'idle' }),
      )
    })

    it('ignores events from the torn-down process', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('sleep 999')
      session.cleanup()
      last().emitStdout('late\n')
      last().emitExit(0)

      expect(session.status).toBe('idle')
      expect(session.events).toHaveLength(0)
    })

    it('is safe to call on an idle session', () => {
      const session = new AsyncSessionRunner({
        runner: { spawn: vi.fn() },
      })

      expect(() => session.cleanup()).not.toThrow()
      expect(session.status).toBe('idle')
    })
  })

  describe('multiple start/stop cycles', () => {
    it('handles multiple start-cancel cycles correctly', () => {
      const { runner, processes } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('cmd1')
      expect(session.status).toBe('running')

      session.cancel()
      expect(session.status).toBe('idle')

      session.start('cmd2')
      expect(session.status).toBe('running')
      expect(processes).toHaveLength(2)
      expect(processes[0]!.killed()).toBe(true)
    })
  })

  describe('output getter', () => {
    it('filters out status/exit events and returns only stdout/stderr', () => {
      const { runner, last } = createMockRunner()
      const session = new AsyncSessionRunner({ runner })

      session.start('cmd')
      last().emitStdout('out\n')
      last().emitStderr('err\n')
      last().emitExit(0)

      expect(session.output).toHaveLength(2)
      expect(
        session.output.every(
          (e) => e.type === 'stdout' || e.type === 'stderr',
        ),
      ).toBe(true)
    })
  })
})
