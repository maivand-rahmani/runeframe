import type { NormalizedMouseEvent } from './SgrMouseStreamParser.js'

/** Shared event channel; transports never own hit-testing or component state. */
export interface MouseEventSource {
  subscribe(listener: (event: NormalizedMouseEvent) => void): () => void
}
