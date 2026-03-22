/**
 * ABOUTME: React hook wrapper for the mark-ready FIFO queue engine.
 * Wires MarkReadyQueueEngine to React state and the beads markTaskReady Effect.
 *
 * Accepts an optional `runMarkReady` override so callers can route mark-ready
 * operations through a scoped runtime (e.g. the TuiWatchController) instead
 * of the default bare Effect.runPromise path.
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

export interface UseMarkReadyQueueOptions {
  /**
   * Custom runner for mark-ready operations. When provided, this is used
   * instead of the default bare `Effect.runPromise(markTaskReady(...))`.
   * This allows the hook to route operations through a scoped runtime
   * such as the TuiWatchController's ManagedRuntime.
   */
  readonly runMarkReady?: (id: string, labels: string[]) => Promise<void>
}

export function useMarkReadyQueue(
  doRefresh: () => void,
  options?: UseMarkReadyQueueOptions,
): UseMarkReadyQueueResult {
  const doRefreshRef = useRef(doRefresh)
  doRefreshRef.current = doRefresh

  const runMarkReadyRef = useRef(options?.runMarkReady)
  runMarkReadyRef.current = options?.runMarkReady

  // Trigger re-renders when queue state changes so pendingIds stays fresh.
  const [, setTick] = useState(0)

  const engineRef = useRef<MarkReadyQueueEngine | null>(null)
  if (engineRef.current === null) {
    engineRef.current = new MarkReadyQueueEngine(
      (id, labels) => {
        const custom = runMarkReadyRef.current
        if (custom) return custom(id, labels)
        return Effect.runPromise(markTaskReady(id, labels))
      },
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
