import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  AsyncSessionRunner,
  DEFAULT_MAX_OUTPUT_LINES,
  type SessionStatus,
  type SessionEvent,
  type SessionLifecycle,
} from './AsyncSessionRunner.js'
import type { ProcessRunner } from './ProcessRunner.js'

export interface UseAsyncSessionOptions {
  runner: ProcessRunner
  /** Call cleanup() on component unmount. Default: true. */
  autoCleanup?: boolean
  /**
   * Maximum number of events retained in React state. Older events are
   * dropped; the runner uses the same bound for its own buffer.
   * Default: 500.
   */
  maxOutputLines?: number
}

export interface UseAsyncSessionResult {
  status: SessionStatus
  /** Bounded event history, including status/exit markers. */
  events: SessionEvent[]
  /** Derived view of `events` filtered to stdout/stderr. */
  output: SessionEvent[]
  /** Exit code of the last finished process, or null. */
  exitCode: number | null
  /** Spawn a process, replacing any currently-running one. */
  start: (command: string, args?: string[]) => void
  /** Forward data to the running process's stdin. */
  sendInput: (data: string) => void
  /** Stop the running process and return to `idle`. */
  cancel: () => void
  /** Tear down the session and reset hook state to idle. */
  cleanup: () => void
  isRunning: boolean
  isComplete: boolean
  isError: boolean
  lastEvent: SessionEvent | null
}

/**
 * React binding for the canonical async/process session lifecycle.
 *
 * Owns one `AsyncSessionRunner` for the lifetime of the component and
 * mirrors its bounded status/event stream into React state. Process
 * management is fully delegated to the configured `ProcessRunner`.
 */
export function useAsyncSession(
  options: UseAsyncSessionOptions,
): UseAsyncSessionResult {
  const { runner, autoCleanup = true, maxOutputLines } = options

  const runnerRef = useRef<AsyncSessionRunner | null>(null)
  if (!runnerRef.current) {
    runnerRef.current = new AsyncSessionRunner({ runner, maxOutputLines })
  }

  // Bound matches the runner's, captured with the runner on first render.
  const eventLimitRef = useRef(maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES)

  const [status, setStatus] = useState<SessionStatus>('idle')
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)

  const lifecycle: SessionLifecycle = useMemo(
    () => ({
      onStatusChange(newStatus: SessionStatus) {
        setStatus(newStatus)
      },
      onEvent(event: SessionEvent) {
        setEvents((prev) => {
          const next = [...prev, event]
          const limit = eventLimitRef.current
          return next.length > limit ? next.slice(next.length - limit) : next
        })
      },
      onExit(code: number | null) {
        setExitCode(code)
      },
    }),
    [],
  )

  const start = useCallback(
    (command: string, args?: string[]) => {
      setEvents([])
      setExitCode(null)
      runnerRef.current!.start(command, args, lifecycle)
    },
    [lifecycle],
  )

  const sendInput = useCallback((data: string) => {
    runnerRef.current!.sendInput(data)
  }, [])

  const cancel = useCallback(() => {
    const sessionRunner = runnerRef.current!
    if (!sessionRunner.isRunning()) return
    sessionRunner.cancel()
    setExitCode(null)
  }, [])

  const cleanup = useCallback(() => {
    runnerRef.current!.cleanup()
    setStatus('idle')
    setEvents([])
    setExitCode(null)
  }, [])

  useEffect(() => {
    if (!autoCleanup) return
    return () => {
      // Silent teardown: no setState after unmount.
      runnerRef.current?.cleanup()
    }
  }, [autoCleanup])

  const output = useMemo(
    () => events.filter((e) => e.type === 'stdout' || e.type === 'stderr'),
    [events],
  )

  const isRunning = status === 'starting' || status === 'running'
  const isComplete = status === 'complete'
  const isError = status === 'error'
  const lastEvent = events.length > 0 ? events[events.length - 1]! : null

  return {
    status,
    events,
    output,
    exitCode,
    start,
    sendInput,
    cancel,
    cleanup,
    isRunning,
    isComplete,
    isError,
    lastEvent,
  }
}
