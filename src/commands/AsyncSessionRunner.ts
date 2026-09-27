import type { ProcessRunner, RunningProcess } from './ProcessRunner.js'

// ── Public Types ──

/**
 * Lifecycle status of an async session.
 *
 * Exactly one status is active at a time. There is no `waiting` state:
 * a session that has consumed all output is still `running` until the
 * process exits.
 */
export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'complete'
  | 'error'

/** Default ring-buffer size for `SessionEvent` history. */
export const DEFAULT_MAX_OUTPUT_LINES = 500

export interface SessionOptions {
  runner: ProcessRunner
  /**
   * Maximum number of events retained in the ring buffer. Must be a
   * non-negative finite integer; `0` retains no events (lifecycle `onEvent`
   * callbacks still fire). Default: 500.
   */
  maxOutputLines?: number
}

export type SessionEventType = 'stdout' | 'stderr' | 'status' | 'error' | 'exit'

export interface SessionEvent {
  type: SessionEventType
  data: string
  timestamp: number
  /** Exit code carried by `exit` events; null when the process was killed. */
  exitCode?: number | null
}

export interface SessionLifecycle {
  onStatusChange?: (status: SessionStatus) => void
  onEvent?: (event: SessionEvent) => void
  onError?: (error: Error) => void
  /**
   * Called once the process has ended and its output has been drained.
   * Receives the exit code, or `null` when no code is available.
   */
  onExit?: (exitCode: number | null) => void
}

// ── Implementation ──

export class AsyncSessionRunner {
  private _status: SessionStatus = 'idle'
  private _events: SessionEvent[] = []
  private _process: RunningProcess | null = null
  private _detach: (() => void) | null = null
  private _exitCode: number | null = null
  private _maxOutputLines: number
  private _runner: ProcessRunner
  private _lifecycle: SessionLifecycle | undefined

  /**
   * @param options - Session configuration. `maxOutputLines` must be a
   *   non-negative integer, otherwise this throws a `RangeError` synchronously
   *   (a negative limit would make the internal trim loop non-terminating).
   */
  constructor(options: SessionOptions) {
    this._runner = options.runner

    const maxOutputLines = options.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES

    if (!Number.isInteger(maxOutputLines) || maxOutputLines < 0) {
      throw new RangeError(
        `maxOutputLines must be an integer >= 0, received ${String(maxOutputLines)}`,
      )
    }

    this._maxOutputLines = maxOutputLines
  }

  // ── Public Accessors ──

  get status(): SessionStatus {
    return this._status
  }

  get events(): readonly SessionEvent[] {
    return this._events
  }

  /** Derived view filtered to stdout/stderr events only. */
  get output(): readonly SessionEvent[] {
    return this._events.filter(
      (e) => e.type === 'stdout' || e.type === 'stderr',
    )
  }

  /** Exit code of the last finished process, or null. */
  get exitCode(): number | null {
    return this._exitCode
  }

  // ── Public Methods ──

  /**
   * Spawn a process. Stops any currently-running process first.
   * Lifecycle callbacks are active for the duration of this session.
   *
   * `args` is forwarded to the `ProcessRunner` adapter verbatim.
   */
  start(
    command: string,
    args?: string[],
    lifecycle?: SessionLifecycle,
  ): void {
    this._stopProcess()

    this._lifecycle = lifecycle
    this._events = []
    this._exitCode = null
    this._setStatus('starting')

    try {
      const proc = this._runner.spawn(command, args)
      this._process = proc

      const offStdout = proc.onStdout((data: string) => {
        if (this._process !== proc) return
        this._addEvent('stdout', data)
      })

      const offStderr = proc.onStderr((data: string) => {
        if (this._process !== proc) return
        this._addEvent('stderr', data)
      })

      const offExit = proc.onExit((code: number | null) => {
        if (this._process !== proc) return
        this._process = null
        this._detach = null
        this._exitCode = code
        this._addEvent('exit', code === null ? '' : String(code), code)
        this._setStatus(code === 0 ? 'complete' : 'error')
        this._lifecycle?.onExit?.(code)
      })

      this._detach = () => {
        offStdout()
        offStderr()
        offExit()
      }

      // An adapter may report exit synchronously during registration.
      // Respect that terminal status instead of overwriting it.
      if (this._process !== proc) return

      this._setStatus('running')
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      this._addEvent('error', error.message)
      this._setStatus('error')
      this._lifecycle?.onError?.(error)
    }
  }

  /** Send data to the process's stdin. No-op if not running. */
  sendInput(data: string): void {
    this._process?.sendStdin(data)
  }

  /**
   * Stop the running process and return to `idle`. Late events from the
   * killed process are discarded. No-op when nothing is running.
   */
  cancel(): void {
    if (!this._process) return
    this._stopProcess()
    this._exitCode = null
    this._setStatus('idle')
  }

  /** True while the session is starting or running. */
  isRunning(): boolean {
    return this._status === 'starting' || this._status === 'running'
  }

  /**
   * Full teardown. Stops the process, clears output buffer and resets state.
   * Silent: it does not emit status events or invoke lifecycle callbacks,
   * so it is safe to call from an unmount cleanup. Safe to call repeatedly.
   */
  cleanup(): void {
    this._stopProcess()
    this._events = []
    this._exitCode = null
    this._lifecycle = undefined
    this._status = 'idle'
  }

  // ── Private ──

  private _setStatus(status: SessionStatus): void {
    this._status = status
    this._addEvent('status', status)
    this._lifecycle?.onStatusChange?.(status)
  }

  private _addEvent(
    type: SessionEventType,
    data: string,
    exitCode?: number | null,
  ): void {
    const event: SessionEvent = { type, data, timestamp: Date.now() }
    if (exitCode !== undefined) {
      event.exitCode = exitCode
    }
    this._events.push(event)

    while (this._events.length > this._maxOutputLines) {
      this._events.shift()
    }

    this._lifecycle?.onEvent?.(event)
  }

  /**
   * Detach listeners and kill the current process without notifying
   * lifecycle callbacks. Guarantees late exit/data events from the old
   * process cannot mutate the next session.
   */
  private _stopProcess(): void {
    const proc = this._process
    if (!proc) return

    this._process = null
    const detach = this._detach
    this._detach = null
    detach?.()
    proc.kill()
  }
}
