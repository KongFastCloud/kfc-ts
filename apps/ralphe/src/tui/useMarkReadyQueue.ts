/**
 * ABOUTME: React hook wrapper for the mark-ready FIFO queue engine.
 * Wires MarkReadyQueueEngine to React state and the beads markTaskReady Effect.
 */

import { useState, useCallback, useRef } from "react"
import { Effect } from "effect"
import { markTaskReady } from "../beads.js"
import { MarkReadyQueueEngine } from "./markReadyQueueEngine.js"

// Re-export engine types for consumers that import from this module.
export type { MarkReadyQueueItem, RunMarkReady } from "./markReadyQueueEngine.js"
export { MarkReadyQueueEngine } from "./markReadyQueueEngine.js"

// ---------------------------------------------------------------------------
// React hook wrapper
// ---------------------------------------------------------------------------

export interface UseMarkReadyQueueResult {
  /** Enqueue a task for mark-ready. No-ops if the ID is already queued or in-flight. */
  readonly enqueue: (item: { id: string; labels: string[] }) => void
  /** Set of all task IDs currently queued or in-flight — use for loading indicators. */
  readonly pendingIds: Set<string>
}

export function useMarkReadyQueue(doRefresh: () => void): UseMarkReadyQueueResult {
  const doRefreshRef = useRef(doRefresh)
  doRefreshRef.current = doRefresh

  // Trigger re-renders when queue state changes so pendingIds stays fresh.
  const [, setTick] = useState(0)

  const engineRef = useRef<MarkReadyQueueEngine | null>(null)
  if (engineRef.current === null) {
    engineRef.current = new MarkReadyQueueEngine(
      (id, labels) => Effect.runPromise(markTaskReady(id, labels)),
      () => doRefreshRef.current(),
      () => setTick((t) => t + 1),
    )
  }

  const enqueue = useCallback(
    (item: { id: string; labels: string[] }) => engineRef.current!.enqueue(item),
    [],
  )

  return { enqueue, pendingIds: engineRef.current.pendingIds }
}
