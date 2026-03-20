/**
 * ABOUTME: FIFO queue hook for serial mark-ready operations.
 * Enqueues mark-ready requests and drains them one at a time in order.
 * After each completion (success or failure), doRefresh() is called.
 * Duplicate task IDs (already queued or in-flight) are rejected on enqueue.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { Effect } from "effect"
import { markTaskReady } from "../beads.js"

// ---------------------------------------------------------------------------
// Queue item type
// ---------------------------------------------------------------------------

export interface MarkReadyQueueItem {
  readonly id: string
  readonly labels: string[]
}

// ---------------------------------------------------------------------------
// Core queue engine (framework-agnostic, testable)
// ---------------------------------------------------------------------------

export type RunMarkReady = (id: string, labels: string[]) => Promise<void>

/**
 * Pure queue engine that drains mark-ready operations serially in FIFO order.
 * Rejects duplicate task IDs. Calls `onDrain` after each completion.
 * Errors are silently swallowed.
 */
export class MarkReadyQueueEngine {
  private _queue: MarkReadyQueueItem[] = []
  private _inFlightId: string | null = null
  private _draining = false

  constructor(
    private readonly _run: RunMarkReady,
    private readonly _onDrain: () => void,
    private readonly _onStateChange: () => void,
  ) {}

  /** All task IDs currently queued or in-flight. */
  get pendingIds(): Set<string> {
    const ids = new Set(this._queue.map((q) => q.id))
    if (this._inFlightId !== null) ids.add(this._inFlightId)
    return ids
  }

  get inFlightId(): string | null {
    return this._inFlightId
  }

  get queueLength(): number {
    return this._queue.length
  }

  /**
   * Enqueue a task. No-ops if the ID is already queued or in-flight.
   * Starts drain automatically.
   */
  enqueue(item: MarkReadyQueueItem): void {
    if (this._inFlightId === item.id) return
    if (this._queue.some((q) => q.id === item.id)) return
    this._queue.push(item)
    this._onStateChange()
    void this._drain()
  }

  // -----------------------------------------------------------------------
  // Internal serial drain loop
  // -----------------------------------------------------------------------

  private async _drain(): Promise<void> {
    if (this._draining) return
    this._draining = true

    try {
      while (this._queue.length > 0) {
        const head = this._queue.shift()!
        this._inFlightId = head.id
        this._onStateChange()

        try {
          await this._run(head.id, head.labels)
        } catch {
          // Silently swallow errors; drain continues.
        }

        this._onDrain()
        this._inFlightId = null
        this._onStateChange()
      }
    } finally {
      this._draining = false
    }
  }
}

// ---------------------------------------------------------------------------
// React hook wrapper
// ---------------------------------------------------------------------------

export interface UseMarkReadyQueueResult {
  /** Enqueue a task for mark-ready. No-ops if the ID is already queued or in-flight. */
  readonly enqueue: (item: MarkReadyQueueItem) => void
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
    (item: MarkReadyQueueItem) => engineRef.current!.enqueue(item),
    [],
  )

  return { enqueue, pendingIds: engineRef.current.pendingIds }
}
