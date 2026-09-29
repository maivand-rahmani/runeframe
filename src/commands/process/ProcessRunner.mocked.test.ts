/**
 * Deterministic adapter tests using a mocked `node:child_process.spawn`.
 *
 * These complement the real child-process smoke tests in
 * `ProcessRunner.test.ts`: they pin the spawn-routing contract (an explicitly
 * empty `args` array must bypass shell/split parsing) and the close-only
 * completion semantics — an `error` event must never complete a session that
 * may still be alive — without depending on OS pipe timing.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncSessionRunner } from './AsyncSessionRunner.js'
import type { SessionEvent } from './AsyncSessionRunner.js'
import { NodeProcessRunner } from './ProcessRunner.js'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

/**
 * Minimal EventEmitter-backed ChildProcess. `stdin`/`stdout`/`stderr` are
 * pipes, matching the stdio configuration used by `NodeProcessRunner`.
 */
function createFakeChild() {
  const stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: vi.fn(() => true),
  })
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const kill = vi.fn(() => true)
  const child = new EventEmitter() as unknown as ChildProcess
  Object.assign(child, { stdin, stdout, stderr, kill })

  return { child, stdin, stdout, stderr, kill }
}

function emitStdout(
  fake: ReturnType<typeof createFakeChild>,
  data: string,
): void {
  fake.stdout.emit('data', Buffer.from(data))
}

describe('NodeProcessRunner spawn routing (mocked spawn)', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('spawns an explicit empty args array directly, bypassing shell parsing', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    new NodeProcessRunner().spawn('my command --with spaces', [])

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0]!
    expect(command).toBe('my command --with spaces')
    expect(args).toEqual([])
    expect(options).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] })
    expect(options).not.toHaveProperty('shell')
  })

  it('forwards explicit args verbatim without filtering', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    new NodeProcessRunner().spawn('git', ['log', '--oneline', ''])

    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      ['log', '--oneline', ''],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
  })

  it('uses the shell when args is omitted (default)', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    new NodeProcessRunner().spawn('echo hello')

    expect(spawnMock).toHaveBeenCalledWith('echo hello', {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  it('splits the command when args is omitted and shell is disabled', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    new NodeProcessRunner({ shell: false }).spawn('node -e "console.log(1)"')

    expect(spawnMock).toHaveBeenCalledWith('node', ['-e', 'console.log(1)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})

describe('NodeRunningProcess completion timing (mocked spawn)', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('reports completion after close so trailing stdout/stderr chunks survive', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    const session = new AsyncSessionRunner({ runner: new NodeProcessRunner() })
    const seen: SessionEvent[] = []
    session.start('streaming', undefined, {
      onEvent: (event) => seen.push(event),
    })

    emitStdout(fake, 'before-exit\n')
    fake.child.emit('exit', 0, null)

    // Native `exit` must not complete the session: stdio may still drain.
    expect(session.status).toBe('running')
    expect(session.exitCode).toBeNull()
    expect(seen.some((event) => event.type === 'exit')).toBe(false)

    // Chunks emitted after native `exit` but before `close` must be preserved.
    emitStdout(fake, 'trailing-stdout\n')
    fake.stderr.emit('data', Buffer.from('trailing-stderr\n'))
    fake.child.emit('close', 0, null)

    expect(session.status).toBe('complete')
    expect(session.exitCode).toBe(0)
    expect(session.output.map((event) => event.data).join('')).toBe(
      'before-exit\ntrailing-stdout\ntrailing-stderr\n',
    )
    // Exit is emitted only after every drained chunk, then the status change.
    expect(session.events.map((event) => event.type)).toEqual([
      'status',
      'status',
      'stdout',
      'stdout',
      'stderr',
      'exit',
      'status',
    ])
  })

  it('notifies onExit exactly once when both error and close fire', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    const proc = new NodeProcessRunner().spawn('missing-binary')
    const exits: Array<number | null> = []
    proc.onExit((code) => exits.push(code))

    fake.child.emit('error', new Error('spawn ENOENT'))

    // `error` alone is not a completion signal: Node may still emit `close`.
    expect(exits).toEqual([])

    fake.child.emit('close', null, null)

    expect(exits).toEqual([null])
  })

  it('completes once on close and keeps output emitted after an error', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    const session = new AsyncSessionRunner({ runner: new NodeProcessRunner() })
    const seen: SessionEvent[] = []
    session.start('streaming', undefined, {
      onEvent: (event) => seen.push(event),
    })

    // `error` may report a non-spawn failure (such as a failed kill) while the
    // process is still alive; it must not complete or drain the session.
    fake.child.emit('error', new Error('kill EPERM'))

    expect(session.status).toBe('running')
    expect(session.exitCode).toBeNull()
    expect(seen.some((event) => event.type === 'exit')).toBe(false)

    // Chunks emitted after the error but before `close` must be retained.
    emitStdout(fake, 'trailing-stdout\n')
    fake.stderr.emit('data', Buffer.from('trailing-stderr\n'))
    fake.child.emit('close', null, null)

    expect(session.status).toBe('error')
    expect(session.exitCode).toBeNull()
    expect(session.output.map((event) => event.data).join('')).toBe(
      'trailing-stdout\ntrailing-stderr\n',
    )
    // Exactly one `exit`, fired only after close drained every chunk.
    expect(seen.filter((event) => event.type === 'exit')).toHaveLength(1)
    expect(session.events.map((event) => event.type)).toEqual([
      'status',
      'status',
      'stdout',
      'stderr',
      'exit',
      'status',
    ])
  })

  it('does not notify onExit on native exit alone', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    const proc = new NodeProcessRunner().spawn('streaming')
    const exits: Array<number | null> = []
    proc.onExit((code) => exits.push(code))

    fake.child.emit('exit', 7, null)

    expect(exits).toEqual([])
  })

  it('ignores stdin writes and kills after close', () => {
    const fake = createFakeChild()
    spawnMock.mockReturnValue(fake.child)

    const proc = new NodeProcessRunner().spawn('exited')
    fake.child.emit('close', 0, null)

    proc.sendStdin('late')
    proc.kill()

    expect(fake.stdin.write).not.toHaveBeenCalled()
    expect(fake.kill).not.toHaveBeenCalled()
  })
})
