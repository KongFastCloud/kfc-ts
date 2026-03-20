/**
 * ABOUTME: Pure FIFO queue engine for serial mark-ready operations.
 * Framework-agnostic and dependency-free — testable without importing beads.
 * Enqueues mark-ready requests and drains them one at a time in order.
 * After each completion (success or failure), onDrain() is called.
 * Duplicate task IDs (already queued or in-flight) are rejected on enqueue.
 */

// ---------------------------------------------------------------------------
// Queue item type
// ---------------------------------------------------------------------------

export interface MarkReadyQueueItem {
  readonly id: string
  readonly labels: string[]
}

// ---------------------------------------------------------------------------
// Core queue engine
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
