import { type ChildProcess, spawn } from 'node:child_process'

// ── Public API Types ──

/**
 * A handle to a running child process, returned by `ProcessRunner.spawn()`.
 */
export interface RunningProcess {
  /** Send data to the process's stdin. */
  sendStdin: (data: string) => void
  /** Force-kill the process (SIGTERM). */
  kill: () => void
  /** Register a stdout-data listener. Returns an unsubscribe function. */
  onStdout: (cb: (data: string) => void) => () => void
  /** Register a stderr-data listener. Returns an unsubscribe function. */
  onStderr: (cb: (data: string) => void) => () => void
  /**
   * Register a completion listener. It is invoked at most once, after the
   * process has ended **and** its stdout/stderr streams have been fully
   * drained and closed (the ChildProcess `close` event, which Node emits even
   * after a spawn `error`). Receives the exit code, or `null` when no code is
   * available (for example, the process was killed by a signal or failed to
   * spawn). Returns an unsubscribe function.
   */
  onExit: (cb: (code: number | null) => void) => () => void
}

/**
 * Abstract interface for spawning processes.
 * Framework consumers provide their own runner or use the default
 * `NodeProcessRunner`.
 */
export interface ProcessRunner {
  /**
   * Spawn a process. `command` is the executable (or a shell command line
   * when `args` is omitted); `args` is passed through to the child process
   * without string interpolation. Passing an explicit empty array spawns
   * `command` with no arguments instead of treating it as a command line.
   */
  spawn: (command: string, args?: string[]) => RunningProcess
}

// ── Default Node.js Implementation ──

type Listener<T> = (value: T) => void

class NodeRunningProcess implements RunningProcess {
  private proc: ChildProcess
  private stdoutListeners = new Set<Listener<string>>()
  private stderrListeners = new Set<Listener<string>>()
  private exitListeners = new Set<Listener<number | null>>()
  private finished = false

  constructor(proc: ChildProcess) {
    this.proc = proc

    // A process may close stdin before it exits; a write racing that close
    // must not surface as an unhandled stream error.
    proc.stdin?.on('error', () => {})

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      for (const cb of this.stdoutListeners) cb(text)
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      for (const cb of this.stderrListeners) cb(text)
    })

    // `close` is the sole completion signal: it fires only after the stdio
    // streams are closed, so every chunk buffered at native `exit` time has
    // already been delivered, and Node also emits it after a spawn `error`.
    // The `error` listener only keeps failures (for example, a failed kill)
    // from becoming unhandled events; an error can fire while the process is
    // still alive and producing output, so it must not complete the session
    // early. The once-guard keeps completion to a single notification.
    proc.on('close', (code) => { this._finish(code) })
    proc.on('error', () => {})
  }

  /** Deliver the terminal notification exactly once. */
  private _finish(code: number | null): void {
    if (this.finished) return
    this.finished = true
    for (const cb of this.exitListeners) cb(code)
  }

  sendStdin(data: string): void {
    if (this.finished || !this.proc.stdin?.writable) return
    this.proc.stdin.write(data)
  }

  kill(): void {
    if (this.finished) return
    this.proc.kill('SIGTERM')
  }

  onStdout(cb: Listener<string>): () => void {
    this.stdoutListeners.add(cb)
    return () => { this.stdoutListeners.delete(cb) }
  }

  onStderr(cb: Listener<string>): () => void {
    this.stderrListeners.add(cb)
    return () => { this.stderrListeners.delete(cb) }
  }

  onExit(cb: Listener<number | null>): () => void {
    this.exitListeners.add(cb)
    return () => { this.exitListeners.delete(cb) }
  }
}

/**
 * Default `ProcessRunner` that shells out via `child_process.spawn`.
 *
 * - `spawn(command)` runs `command` as a shell command line when `shell` is
 *   enabled (the default), or splits it on unquoted whitespace otherwise.
 * - `spawn(command, args)` executes `command` directly with `args`, without
 *   shell parsing, so arguments are never re-joined or re-quoted. An
 *   explicitly empty `args` array spawns `command` with no arguments; it does
 *   not fall back to shell or command-line parsing.
 *
 * `RunningProcess.onExit` fires only after stdio has been drained (the
 * underlying ChildProcess `close` event), never merely on native `exit` and
 * never on an `error` event, which can fire while the process is still alive.
 *
 * @example
 * ```ts
 * const runner = new NodeProcessRunner()
 * runner.spawn('npm', ['run', 'build'])
 * ```
 */
export class NodeProcessRunner implements ProcessRunner {
  private shell: boolean

  constructor(options?: { shell?: boolean }) {
    this.shell = options?.shell ?? true
  }

  spawn(command: string, args?: string[]): RunningProcess {
    if (args !== undefined) {
      return new NodeRunningProcess(
        spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] }),
      )
    }

    if (this.shell) {
      const proc = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      return new NodeRunningProcess(proc)
    }

    const parts = splitCommand(command)
    const [cmd, ...rest] = parts
    const proc = spawn(cmd ?? '', rest, { stdio: ['pipe', 'pipe', 'pipe'] })
    return new NodeRunningProcess(proc)
  }
}

/**
 * Simple shell-aware command splitter.
 * Handles single and double quotes.
 */
function splitCommand(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (const ch of input) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }

  if (current.length > 0) parts.push(current)
  return parts
}
