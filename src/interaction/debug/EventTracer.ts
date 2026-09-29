import type { NormalizedKeyEvent } from '../../types.js'

const DEFAULT_MAX_ENTRIES = 200

export interface TraceEntry {
  event: NormalizedKeyEvent
  timestamp: number
  handlerChain: string[]
  consumedBy: string | null
}

export class EventTracer {
  private buffer: TraceEntry[] = []
  private _enabled = false
  private maxEntries: number

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries
  }

  trace(
    event: NormalizedKeyEvent,
    result: { consumed: boolean; scope: string | null; handlerChain?: string[] },
  ): void {
    if (!this._enabled) return

    const entry: TraceEntry = {
      event,
      timestamp: Date.now(),
      handlerChain: result.handlerChain ?? [],
      consumedBy: result.consumed ? result.scope : null,
    }

    this.buffer.push(entry)

    if (this.buffer.length > this.maxEntries) {
      this.buffer = this.buffer.slice(-this.maxEntries)
    }
  }

  getTrace(): TraceEntry[] {
    return [...this.buffer]
  }

  get enabled(): boolean {
    return this._enabled
  }

  clear(): void {
    this.buffer = []
  }

  enable(): void {
    this._enabled = true
  }

  disable(): void {
    this._enabled = false
  }
}
