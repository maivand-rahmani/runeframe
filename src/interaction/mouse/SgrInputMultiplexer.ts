import { Readable } from 'node:stream'
import type { MouseEventSource } from './MouseEventSource.js'
import {
  SgrMouseStreamParser,
  type NormalizedMouseEvent,
} from './SgrMouseStreamParser.js'

/**
 * Bounded window for assembling a lone `ESC` or a partial SGR candidate before
 * the held bytes are passed through to the Ink stream as ordinary keyboard
 * input. Kept at or below {@link MAX_SGR_INPUT_FLUSH_TIMEOUT_MS}.
 */
export const DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS = 60

/**
 * Hard cap for {@link SgrInputMultiplexerOptions.flushTimeoutMs}: held input
 * must never be stalled longer than this.
 */
export const MAX_SGR_INPUT_FLUSH_TIMEOUT_MS = 60

/**
 * Cap on mouse events buffered while a delivery gate is closed (no subscriber
 * yet, or preceding keyboard bytes not consumed). When the cap is exceeded the
 * oldest event is dropped: the newest pointer state survives, memory stays
 * bounded, and a dropped press can only orphan a later release (which the
 * router consumes without activating).
 */
export const MAX_PENDING_MOUSE_EVENTS = 64

export interface SgrInputMultiplexerOptions {
  /**
   * Prefix-assembly window in milliseconds. Defaults to
   * {@link DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS}; values above
   * {@link MAX_SGR_INPUT_FLUSH_TIMEOUT_MS} are clamped.
   */
  flushTimeoutMs?: number
  /**
   * Called once when the source emits `'error'`, after the multiplexer has
   * flushed held bytes, ended its Ink stream and restored source raw mode.
   * Use it to report and unmount so the app cannot sit in a dead fullscreen.
   * Callback errors are swallowed and never mask the source event.
   */
  onSourceError?: (error: unknown) => void
  /**
   * Called once when the source ends unexpectedly (EOF before `dispose()`),
   * after the same cleanup as
   * {@link SgrInputMultiplexerOptions.onSourceError}.
   */
  onSourceEnd?: () => void
}

/**
 * One common input multiplexer for Ink 7.
 *
 * It is the sole consumer of the original byte source: exactly one
 * `source.on('data')` subscription, never a competing `'readable'` consumer
 * and never a second real `stdin` listener. Raw chunks are scanned by
 * {@link SgrMouseStreamParser}; byte-exact non-mouse bytes are pushed to
 * {@link stdin} for Ink, and normalized mouse events are published separately
 * through {@link mouseEvents} in stream order. Consumed mouse reports are
 * never fed to Ink.
 *
 * Mouse events are buffered (bounded) until the first subscriber arrives and
 * until every keyboard byte that preceded them has been consumed by the Ink
 * stream, so an early click is not lost and a click that shares a chunk with
 * the keyboard navigation that reveals its target is routed after that
 * navigation has been processed.
 */
export interface SgrInputMultiplexer {
  /**
   * Ink-facing input stream: a `Readable` with the `NodeJS.ReadStream` surface
   * Ink 7 touches (`isTTY`, `setRawMode`, `ref`, `unref`, `isRaw`,
   * `setEncoding`). Pass it as `render(..., { stdin })`.
   */
  stdin: NodeJS.ReadStream
  /** Normalized mouse channel, independent from the Ink keyboard stream. */
  mouseEvents: MouseEventSource
  /**
   * Terminal teardown: flushes held bytes exactly once, detaches every source
   * listener, clears the flush timer, ends {@link stdin} and restores source
   * raw mode. Idempotent.
   */
  dispose(): void
}

interface MultiplexedStdinHooks {
  /** The consumer wants more bytes: resume a source paused by backpressure. */
  onReadDemand(): void
  /**
   * The consumer called `read()` again after holding a previously returned
   * chunk, proving that chunk's synchronous processing finished.
   */
  onReadProcessed(): void
  /** Raw mode flipped; disabling is a flush point. */
  onRawModeChange(enabled: boolean): void
}

/**
 * Ink-facing Readable. Backpressure is native: when `push()` reports a full
 * buffer the multiplexer pauses the source, and the next `_read()` demand from
 * the consumer resumes it.
 *
 * Raw-mode state is tracked so a repeated `setRawMode(true)`/`setRawMode(false)`
 * neither re-delegates to the source nor re-triggers the disable flush. The
 * multiplexer never calls `source.setRawMode` itself except in
 * {@link restoreRawMode} during teardown; Ink drives enable/disable through
 * this method.
 */
class MultiplexedStdin extends Readable {
  readonly isTTY: boolean
  private readonly source: NodeJS.ReadStream
  private readonly hooks: MultiplexedStdinHooks
  private rawMode = false
  /**
   * True while the consumer holds a chunk previously returned by `read()`.
   * A following `read()` call proves the consumer finished its synchronous
   * processing of that chunk (Ink's input loop reads and processes in one
   * synchronous loop), which is the ordering boundary for deferred mouse
   * delivery.
   */
  private pendingProcessing = false

  constructor(source: NodeJS.ReadStream, hooks: MultiplexedStdinHooks) {
    super()
    this.source = source
    this.hooks = hooks
    this.isTTY = Boolean((source as { isTTY?: unknown }).isTTY)
  }

  _read(): void {
    this.hooks.onReadDemand()
  }

  read(size?: number): unknown {
    const hadPendingProcessing = this.pendingProcessing
    this.pendingProcessing = false
    if (hadPendingProcessing && this.readableLength === 0) {
      this.hooks.onReadProcessed()
    }
    const result = super.read(size as number)
    if (result !== null && result !== undefined) this.pendingProcessing = true
    return result
  }

  get isRaw(): boolean {
    const sourceIsRaw = (this.source as { isRaw?: unknown }).isRaw
    return typeof sourceIsRaw === 'boolean' ? sourceIsRaw : this.rawMode
  }

  setRawMode(mode: boolean): this {
    const next = Boolean(mode)
    if (next === this.rawMode) return this
    const setRawMode = (this.source as { setRawMode?: unknown }).setRawMode
    if (typeof setRawMode === 'function') {
      if (next) {
        // Enabling must not be silent: a failed delegate surfaces to Ink so
        // the app fails visibly instead of reading a non-raw source.
        ;(setRawMode as (mode: boolean) => unknown).call(this.source, next)
      } else {
        // Disabling is teardown-adjacent: best effort, but never claim the
        // source left raw mode when the delegate failed (a later dispose
        // restore retries it).
        try {
          ;(setRawMode as (mode: boolean) => unknown).call(this.source, next)
        } catch {
          return this
        }
      }
    }
    this.rawMode = next
    this.hooks.onRawModeChange(next)
    return this
  }

  /**
   * Best-effort restore of the raw mode this stream enabled. Used on dispose
   * and unexpected source termination so a mounted Ink that never unmounts
   * cannot leave the source in raw mode. Idempotent and never throws.
   */
  restoreRawMode(): void {
    if (!this.rawMode) return
    this.rawMode = false
    const setRawMode = (this.source as { setRawMode?: unknown }).setRawMode
    if (typeof setRawMode === 'function') {
      try {
        ;(setRawMode as (mode: boolean) => unknown).call(this.source, false)
      } catch {
        // Restoration is best effort; teardown must not throw.
      }
    }
  }

  ref(): this {
    const ref = (this.source as { ref?: unknown }).ref
    if (typeof ref === 'function') {
      try {
        ;(ref as () => unknown).call(this.source)
      } catch {
        // Process ref hints are best effort.
      }
    }
    return this
  }

  unref(): this {
    const unref = (this.source as { unref?: unknown }).unref
    if (typeof unref === 'function') {
      try {
        ;(unref as () => unknown).call(this.source)
      } catch {
        // Process ref hints are best effort.
      }
    }
    return this
  }
}

function normalizeFlushTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS
  }
  return Math.min(value, MAX_SGR_INPUT_FLUSH_TIMEOUT_MS)
}

class SgrInputMultiplexerImpl implements SgrInputMultiplexer {
  readonly stdin: NodeJS.ReadStream
  readonly mouseEvents: MouseEventSource

  private readonly source: NodeJS.ReadStream
  private readonly options: SgrInputMultiplexerOptions
  private readonly parser = new SgrMouseStreamParser()
  private readonly subscribers = new Set<
    (event: NormalizedMouseEvent) => void
  >()
  private readonly flushTimeoutMs: number
  private readonly ink: MultiplexedStdin

  /**
   * Mouse events buffered until delivery gates open: the first subscriber has
   * arrived and every keyboard byte pushed before the event has been consumed
   * by the Ink stream. Bounded by {@link MAX_PENDING_MOUSE_EVENTS}.
   */
  private readonly pendingMouse: NormalizedMouseEvent[] = []
  private mouseGateOpen = true
  private firstSubscriberSeen = false

  private timer: ReturnType<typeof setTimeout> | null = null
  private sourcePaused = false
  private sourceEnded = false
  private inkEnded = false
  private disposed = false
  private mouseFlushScheduled = false

  constructor(source: NodeJS.ReadStream, options: SgrInputMultiplexerOptions) {
    this.source = source
    this.options = options
    this.flushTimeoutMs = normalizeFlushTimeout(options.flushTimeoutMs)
    this.ink = new MultiplexedStdin(source, {
      onReadDemand: () => this.resumeSource(),
      onReadProcessed: () => this.handleReadProcessed(),
      onRawModeChange: (enabled) => this.handleRawModeChange(enabled),
    })
    this.stdin = this.ink as unknown as NodeJS.ReadStream
    this.mouseEvents = {
      subscribe: (listener: (event: NormalizedMouseEvent) => void) => {
        this.subscribers.add(listener)
        if (!this.firstSubscriberSeen) {
          this.firstSubscriberSeen = true
          // Events that arrived before the owner subscribed are delivered
          // exactly once, in stream order.
          this.flushPendingMouse()
        }
        return () => {
          this.subscribers.delete(listener)
        }
      },
    }

    this.onSourceData = this.onSourceData.bind(this)
    this.onSourceEnd = this.onSourceEnd.bind(this)
    this.onSourceError = this.onSourceError.bind(this)

    // Sole subscription to the original source: one flowing `'data'`
    // listener, no `'readable'` reader, no `source.read()` calls.
    source.on('data', this.onSourceData)
    source.on('end', this.onSourceEnd)
    source.on('error', this.onSourceError)
  }

  dispose(): void {
    if (this.disposed) return
    this.clearFlushTimer()
    this.flushPendingToInk()
    this.disposed = true
    // Buffered mouse events are dropped: the owner is tearing down and must
    // not receive routing callbacks after disposal.
    this.pendingMouse.length = 0
    this.removeSourceListeners()
    this.endInk()
    this.ink.restoreRawMode()
    this.pauseSource()
  }

  private onSourceData(chunk: Buffer | string): void {
    if (this.disposed || this.sourceEnded || this.inkEnded) return
    // Sources are never given an encoding by this multiplexer, so chunks are
    // Buffers in practice; string chunks are converted without decoding any
    // further and are still routed byte-exactly.
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    const output = this.parser.push(bytes)
    for (const item of output) {
      if (item.type === 'keyboard') {
        this.pushToInk(item.data)
      } else {
        this.deliverMouse(item.event)
      }
    }
    if (this.parser.hasPending()) {
      this.armFlushTimer()
    } else {
      this.clearFlushTimer()
    }
  }

  private onSourceEnd(): void {
    if (this.disposed || this.sourceEnded) return
    this.sourceEnded = true
    this.finishSource()
    this.notifySourceTermination('end')
  }

  private onSourceError(error: unknown): void {
    // This multiplexer owns the only source subscription, so it must absorb
    // `'error'` to avoid an unhandled `'error'` throw. The owner is notified
    // visibly through `onSourceError` so the app can report and unmount.
    if (this.disposed || this.sourceEnded) return
    this.sourceEnded = true
    this.finishSource()
    this.notifySourceTermination('error', error)
  }

  /**
   * Shared unexpected-termination cleanup: flush held bytes, end the Ink
   * stream and restore raw mode. Restoring here means a mounted Ink that
   * never unmounts (or unmounts later) cannot leave the source in raw mode.
   */
  private finishSource(): void {
    this.clearFlushTimer()
    this.flushPendingToInk()
    this.endInk()
    this.ink.restoreRawMode()
  }

  private notifySourceTermination(
    kind: 'error' | 'end',
    error?: unknown,
  ): void {
    try {
      if (kind === 'error') this.options.onSourceError?.(error)
      else this.options.onSourceEnd?.()
    } catch {
      // Owner callbacks must never break the input path or mask the event.
    }
  }

  private handleRawModeChange(enabled: boolean): void {
    if (enabled || this.disposed) return
    // Disabling raw mode is a flush point: bytes held for prefix assembly
    // must not be lost while Ink is tearing input down. Exactly once per
    // transition; duplicate disables are filtered by `setRawMode`.
    this.clearFlushTimer()
    this.flushPendingToInk()
  }

  private pushToInk(data: Buffer): void {
    if (this.inkEnded || data.length === 0) return
    if (!this.ink.push(data)) this.pauseSource()
    // Flowing consumers receive bytes synchronously, so an empty readable
    // buffer means no keyboard byte is waiting to be processed. Otherwise the
    // gate closes until the consumer has processed the returned chunk.
    this.mouseGateOpen = this.ink.readableLength === 0
  }

  /**
   * Queue one normalized event behind the delivery gates. While the gate is
   * closed the event waits for the first subscriber and/or for the consumer
   * to process the keyboard bytes that preceded it, so a same-chunk click is
   * routed against the screen state the keyboard input produced.
   */
  private deliverMouse(event: NormalizedMouseEvent): void {
    this.pendingMouse.push(event)
    if (this.pendingMouse.length > MAX_PENDING_MOUSE_EVENTS) {
      // Overflow policy: drop the oldest buffered event (see the constant).
      this.pendingMouse.shift()
    }
    this.flushPendingMouse()
  }

  private flushPendingMouse(): void {
    if (!this.mouseGateOpen || !this.firstSubscriberSeen) return
    if (this.pendingMouse.length === 0) return
    const events = this.pendingMouse.splice(0)
    for (const event of events) this.publish(event)
  }

  /**
   * The consumer finished processing a previously returned chunk. Opening the
   * gate is deferred by one microtask because Ink dispatches input through
   * React's discrete-update lane, whose synchronous commit is flushed in a
   * microtask queued before this hook runs. Waiting one microtask therefore
   * lets the route/tab state and its commit-synchronous layout effects (mouse
   * area registration) land before any deferred click is routed, without any
   * timer or arbitrary delay.
   */
  private handleReadProcessed(): void {
    if (this.ink.readableLength !== 0) return
    if (this.mouseFlushScheduled) return
    this.mouseFlushScheduled = true
    queueMicrotask(() => {
      this.mouseFlushScheduled = false
      if (this.disposed) return
      if (this.ink.readableLength !== 0) return
      this.mouseGateOpen = true
      this.flushPendingMouse()
    })
  }

  private publish(event: NormalizedMouseEvent): void {
    // Snapshot so unsubscribing during a dispatch cannot skip listeners, and
    // isolate throwing consumers so the input pipeline never breaks.
    for (const listener of [...this.subscribers]) {
      try {
        listener(event)
      } catch {
        // A throwing mouse consumer must not affect keyboard routing.
      }
    }
  }

  private pauseSource(): void {
    if (this.sourcePaused || this.sourceEnded) return
    this.sourcePaused = true
    const pause = (this.source as { pause?: unknown }).pause
    if (typeof pause === 'function') (pause as () => unknown).call(this.source)
  }

  private resumeSource(): void {
    if (!this.sourcePaused || this.disposed || this.sourceEnded) return
    this.sourcePaused = false
    const resume = (this.source as { resume?: unknown }).resume
    if (typeof resume === 'function') {
      (resume as () => unknown).call(this.source)
    }
  }

  private armFlushTimer(): void {
    this.clearFlushTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushPendingToInk()
    }, this.flushTimeoutMs)
  }

  private clearFlushTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private flushPendingToInk(): void {
    const pending = this.parser.flush()
    if (pending.length > 0) this.pushToInk(pending)
  }

  private endInk(): void {
    if (this.inkEnded) return
    this.inkEnded = true
    this.ink.push(null)
  }

  private removeSourceListeners(): void {
    this.source.removeListener('data', this.onSourceData)
    this.source.removeListener('end', this.onSourceEnd)
    this.source.removeListener('error', this.onSourceError)
  }
}

/**
 * Build the single multiplexer between one raw byte source (for example
 * `process.stdin` or a Windows VT reader) and Ink.
 *
 * The returned `stdin` is passed to `render(..., { stdin })`; the returned
 * `mouseEvents` publishes normalized mouse reports; `dispose()` tears the
 * transport down. The multiplexer never sets terminal modes itself — Ink 7
 * drives `setRawMode`/`ref`/`unref` through the returned stream, which
 * delegates to the source. No data is read until the source emits, and
 * no platform-specific behavior is encoded here.
 */
export function createSgrInputMultiplexer(
  source: NodeJS.ReadStream,
  options: SgrInputMultiplexerOptions = {},
): SgrInputMultiplexer {
  return new SgrInputMultiplexerImpl(source, options)
}
