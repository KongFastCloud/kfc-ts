/**
 * ABOUTME: Scoped TUI watch controller — runtime owner for watch-mode state,
 * commands, and lifecycle. All watch-mode Effect operations run through a
 * single ManagedRuntime configured with TuiLoggerLayer, ensuring consistent
 * logging and eliminating scattered bare Effect.runPromise calls.
 *
 * The worker runs as a daemon fiber forked directly on the controller's
 * ManagedRuntime via tuiWorkerEffect, ensuring it inherits the TUI-safe
 * logger layer with no default-runtime escape hatch.
 * The mark-ready consumer and periodic refresh also run as daemon fibers
 * inside the managed runtime. Shutdown is driven by fiber interruption
 * and queue shutdown.
 *
 * Mark-ready operations are serialized through an Effect-native Queue owned
 * by the controller. The queue preserves FIFO ordering and non-blocking
 * enqueue semantics. A consumer fiber drains the queue inside the managed
 * runtime, ensuring consistent logging and error handling.
 *
 * Epic deletion is serialized through a separate Effect-native Queue.
 * Each deletion triggers closeEpic (which closes the Beads issue and
 * removes the worktree). The epic disappears from the TUI after cleanup.
 *
 * Epic display state is derived from the task list, worktree status checks,
 * and the local deletion queue. Worktree status is checked after each
 * refresh for all open epics.
 *
 * React and OpenTUI remain adapter consumers of controller state and commands.
 * Promise-returning UI callbacks delegate through the controller's runtime.
 */

import os from "node:os"
import { Effect, Fiber, ManagedRuntime, Queue, type Layer } from "effect"
import type { WatchTask } from "./beadsAdapter.js"
import { queryAllTasks, queryTaskDetail } from "./beadsAdapter.js"
import { markTaskReady, closeEpic } from "./beads.js"
import type { WorkerStatus, TuiWorkerDeps } from "./tuiWorker.js"
import { tuiWorkerEffect } from "./tuiWorker.js"
import { loadConfig } from "./config.js"
import type { EpicDisplayItem } from "./tui/epicStatus.js"
import { deriveEpicDisplayItems, isEpicTask } from "./tui/epicStatus.js"
import type { EpicWorktreeState } from "./epicWorktree.js"
import { getEpicWorktreeState } from "./epicWorktree.js"
import type { EpicRuntimeStatus } from "./epicRuntimeState.js"
import { getEpicRuntimeStatus } from "./epicRuntimeState.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A mark-ready queue item — the task ID and its current labels. */
export interface MarkReadyQueueItem {
  readonly id: string
  readonly labels: string[]
}

/** An epic-delete queue item — the epic ID to close and clean up. */
export interface EpicDeleteQueueItem {
  readonly id: string
}

/**
 * Observable snapshot of the controller's state.
 * UI components read this to render; the controller is the single owner.
 */
export interface TuiWatchControllerState {
  readonly workerStatus: WorkerStatus
  readonly latestTasks: WatchTask[]
  readonly refreshError: string | undefined
  readonly lastRefreshed: Date | null
  /** IDs of tasks currently queued or in-flight for mark-ready. */
  readonly markReadyPendingIds: ReadonlySet<string>
  /** Full detail for the currently viewed task (from bd show). */
  readonly detailTask: WatchTask | undefined
  /** Whether a detail fetch is in-flight. */
  readonly detailLoading: boolean
  /** Error message from the last detail fetch failure. */
  readonly detailError: string | undefined
  /** The task ID currently being viewed in detail. */
  readonly detailTaskId: string | undefined
  /** Epic display items derived from tasks + worktree state + deletion queue. */
  readonly epics: EpicDisplayItem[]
  /** IDs of epics currently queued or in-flight for deletion. */
  readonly epicDeletePendingIds: ReadonlySet<string>
}

export interface TuiWatchControllerOptions {
  /** Poll / refresh interval in milliseconds. Default 10_000. */
  readonly refreshIntervalMs?: number
  /** Working directory. Default process.cwd(). */
  readonly workDir?: string
  /** Worker ID. Default hostname-based. */
  readonly workerId?: string
  /** Test-only dependency overrides for deterministic controller behavior. */
  readonly deps?: Partial<TuiWatchControllerDeps>
}

export interface TuiWatchControllerDeps {
  readonly queryAllTasks: typeof queryAllTasks
  readonly queryTaskDetail: typeof queryTaskDetail
  readonly markTaskReady: typeof markTaskReady
  readonly tuiWorkerEffect: typeof tuiWorkerEffect
  readonly loadConfig: typeof loadConfig
  readonly closeEpic: typeof closeEpic
  readonly getEpicWorktreeState: typeof getEpicWorktreeState
  readonly getEpicRuntimeStatus: typeof getEpicRuntimeStatus
  /** Test-only dependency overrides passed through to the worker. */
  readonly workerDeps?: Partial<TuiWorkerDeps>
}

/**
 * The controller surface consumed by the TUI adapter layer.
 * Commands return promises because the UI libraries (React/OpenTUI) require
 * callback-shaped APIs, but every promise is backed by the scoped runtime.
 */
export interface TuiWatchController {
  // -- State observation ----------------------------------------------------
  /** Current snapshot of controller state. */
  getState(): TuiWatchControllerState

  // -- Commands (run through the scoped TUI runtime) ------------------------
  /**
   * Load initial tasks. Wraps refresh() with graceful error handling so that
   * a load failure is captured in refreshError rather than thrown.
   */
  initialLoad(): Promise<void>
  /** Refresh the task list. Returns updated tasks. */
  refresh(): Promise<WatchTask[]>
  /**
   * Enqueue a mark-ready action into the Effect-native serialized queue.
   * Non-blocking and synchronous — safe to call from React callbacks.
   * Duplicate task IDs (already queued or in-flight) are silently rejected.
   */
  enqueueMarkReady(id: string, labels: string[]): void
  /** Mark a task as ready (direct, non-queued). */
  markReady(id: string, labels: string[]): Promise<void>
  /**
   * Enqueue an epic deletion action. Immediate, no confirmation.
   * The epic will be closed in Beads and its worktree removed.
   * Duplicate epic IDs are silently rejected.
   */
  enqueueEpicDelete(id: string): void
  /**
   * Enter detail view for the given task ID. Triggers a full detail fetch
   * (bd show) and stores the result. Immediately sets detailTaskId so the
   * UI can reconcile from list data while the fetch is in-flight.
   */
  fetchTaskDetail(taskId: string): Promise<void>
  /**
   * Exit detail view. Clears all detail-specific state.
   */
  exitDetailView(): void
  /**
   * Run an arbitrary Effect through the controller's scoped runtime.
   * Intended for one-off operations that must share the TUI logger and
   * runtime configuration. Typed errors are surfaced as rejections.
   */
  runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A>

  // -- Lifecycle ------------------------------------------------------------
  /**
   * Start the worker loop. The worker runs as Effect-managed orchestration
   * (tuiWorkerEffect) with fiber-based interruption for clean shutdown.
   */
  startWorker(): void
  /**
   * Start the mark-ready consumer fiber. Must be called (and awaited) before
   * enqueueMarkReady is used — typically as part of the TUI startup sequence.
   */
  startMarkReadyConsumer(): Promise<void>
  /**
   * Start the epic-delete consumer fiber. Must be called (and awaited) before
   * enqueueEpicDelete is used — typically as part of the TUI startup sequence.
   */
  startEpicDeleteConsumer(): Promise<void>
  /** Start the periodic UI data refresh as a daemon fiber. */
  startPeriodicRefresh(): void
  /**
   * Stop the worker, interrupt refresh and mark-ready fibers, and dispose
   * the managed runtime.
   */
  stop(): Promise<void>

  // -- Event subscription ---------------------------------------------------
  /** Register a callback invoked whenever controller state changes. */
  onStateChange(listener: () => void): void
  /** Remove a previously registered state-change listener. */
  removeStateChangeListener(listener: () => void): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TUI watch controller backed by a ManagedRuntime built from the
 * given layer. The layer should include TuiLoggerLayer and any other
 * services the watch-mode pipeline requires.
 *
 * The returned controller is the single runtime owner — all watch-mode
 * Effect operations are funnelled through it.
 */
export function createTuiWatchController(
  layer: Layer.Layer<never>,
  opts?: TuiWatchControllerOptions,
): TuiWatchController {
  const refreshIntervalMs = opts?.refreshIntervalMs ?? 10_000
  const workDir = opts?.workDir ?? process.cwd()
  const workerId = opts?.workerId ?? `ralphe-${os.hostname()}`
  const deps: TuiWatchControllerDeps = {
    queryAllTasks,
    queryTaskDetail,
    markTaskReady,
    tuiWorkerEffect,
    loadConfig,
    closeEpic,
    getEpicWorktreeState,
    getEpicRuntimeStatus,
    ...opts?.deps,
  }

  // -----------------------------------------------------------------------
  // Scoped runtime — created once, reused for every Effect execution
  // -----------------------------------------------------------------------
  const managedRuntime = ManagedRuntime.make(layer)

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let workerStatus: WorkerStatus = { state: "idle" }
  let latestTasks: WatchTask[] = []
  let refreshError: string | undefined
  let lastRefreshed: Date | null = null
  let workerFiber: Fiber.RuntimeFiber<void, never> | null = null
  let refreshInFlight = false

  // -- Detail-view state ---------------------------------------------------
  let detailTask: WatchTask | undefined
  let detailLoading = false
  let detailError: string | undefined
  let detailTaskId: string | undefined

  // -- Fiber handles -------------------------------------------------------
  let refreshFiber: Fiber.RuntimeFiber<void, never> | null = null

  // -- Mark-ready queue state -----------------------------------------------
  let markReadyQueue: Queue.Queue<MarkReadyQueueItem> | null = null
  let markReadyPendingIds = new Set<string>()

  // -- Epic state -----------------------------------------------------------
  let epics: EpicDisplayItem[] = []
  let epicDeleteQueue: Queue.Queue<EpicDeleteQueueItem> | null = null
  let epicDeletePendingIds = new Set<string>()

  const listeners: Array<() => void> = []

  const notifyListeners = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Run an Effect through the scoped TUI runtime.
   * Typed errors are surfaced as defects (thrown) so the caller receives
   * a rejected promise — matching the behavior of bare Effect.runPromise.
   */
  const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    managedRuntime.runPromise(
      Effect.catchAll(effect, (e) => Effect.die(e)),
    )

  /**
   * Compute epic display items by checking worktree states for all open epics.
   * This runs through the managed runtime since worktree checks are Effects.
   */
  const computeEpicDisplayItems = async (tasks: WatchTask[]): Promise<EpicDisplayItem[]> => {
    const epicTasks = tasks.filter(isEpicTask)
    if (epicTasks.length === 0 && epicDeletePendingIds.size === 0) return []

    // Check worktree state for each epic in parallel
    const worktreeStates = new Map<string, EpicWorktreeState>()
    const runtimeStates = new Map<string, EpicRuntimeStatus>()
    try {
      const results = await run(
        Effect.all(
          epicTasks.map((t) =>
            deps.getEpicWorktreeState(t.id).pipe(
              Effect.map((state) => [t.id, state] as const),
              // If worktree check fails, treat as not_started
              Effect.catchAll(() => Effect.succeed([t.id, "not_started" as const] as const)),
            ),
          ),
          { concurrency: "unbounded" },
        ),
      )
      for (const [id, state] of results) {
        worktreeStates.set(id, state)
      }
    } catch {
      // If all checks fail, proceed with empty worktree states
    }

    try {
      const results = await run(
        Effect.all(
          epicTasks.map((t) =>
            deps.getEpicRuntimeStatus(t.id).pipe(
              Effect.map((state) => [t.id, state] as const),
              // If runtime-state read fails, treat as no_attempt.
              Effect.catchAll(() => Effect.succeed([t.id, "no_attempt" as const] as const)),
            ),
          ),
          { concurrency: "unbounded" },
        ),
      )
      for (const [id, state] of results) {
        runtimeStates.set(id, state)
      }
    } catch {
      // If all checks fail, proceed with empty runtime states
    }

    return deriveEpicDisplayItems(tasks, worktreeStates, runtimeStates, epicDeletePendingIds)
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const controller: TuiWatchController = {
    getState(): TuiWatchControllerState {
      return {
        workerStatus, latestTasks, refreshError, lastRefreshed, markReadyPendingIds,
        detailTask, detailLoading, detailError, detailTaskId,
        epics, epicDeletePendingIds,
      }
    },

    async initialLoad(): Promise<void> {
      try {
        await controller.refresh()
      } catch (e) {
        // Capture as refreshError (already set by refresh()), but format
        // specifically for the initial-load context if not already set.
        const msg = e instanceof Error ? e.message : String(e)
        refreshError = `Could not load tasks: ${msg}`
        notifyListeners()
      }
    },

    async refresh(): Promise<WatchTask[]> {
      if (refreshInFlight) return latestTasks
      refreshInFlight = true
      try {
        const tasks = await run(deps.queryAllTasks(workDir))
        latestTasks = tasks
        refreshError = undefined
        lastRefreshed = new Date()

        // Derive epic display items from the refreshed task list
        epics = await computeEpicDisplayItems(tasks)

        notifyListeners()

        // Re-resolve detail for the currently viewed task so the detail
        // pane stays current across refreshes without losing context.
        if (detailTaskId) {
          void controller.fetchTaskDetail(detailTaskId).catch(() => {
            // Detail re-fetch failure is non-fatal; the user sees the
            // error in detailError state.
          })
        }

        return tasks
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        refreshError = `Refresh failed: ${msg}`
        notifyListeners()
        throw e
      } finally {
        refreshInFlight = false
      }
    },

    enqueueMarkReady(id: string, labels: string[]): void {
      if (!markReadyQueue) return // Consumer not started yet
      if (markReadyPendingIds.has(id)) return // Duplicate rejection
      markReadyPendingIds = new Set([...markReadyPendingIds, id])
      notifyListeners()
      // Queue.offer on an unbounded queue always succeeds immediately.
      // We run it through the managed runtime to stay within the scoped
      // Effect context — no bare default runtime escape hatch.
      void managedRuntime.runPromise(Queue.offer(markReadyQueue, { id, labels }))
    },

    async markReady(id: string, labels: string[]): Promise<void> {
      await run(deps.markTaskReady(id, labels))
    },

    enqueueEpicDelete(id: string): void {
      if (!epicDeleteQueue) return // Consumer not started yet
      if (epicDeletePendingIds.has(id)) return // Duplicate rejection
      epicDeletePendingIds = new Set([...epicDeletePendingIds, id])

      // Immediately update epic display to show queued_for_deletion status
      epics = epics.map((e) =>
        e.id === id ? { ...e, status: "queued_for_deletion" as const } : e,
      )
      notifyListeners()

      void managedRuntime.runPromise(Queue.offer(epicDeleteQueue, { id }))
    },

    async fetchTaskDetail(taskId: string): Promise<void> {
      detailTaskId = taskId
      detailLoading = true
      detailError = undefined
      notifyListeners()
      try {
        const task = await run(deps.queryTaskDetail(taskId, workDir))
        // Guard: only apply result if we're still viewing this task
        if (detailTaskId !== taskId) return
        detailTask = task
        detailLoading = false
        detailError = task ? undefined : `Task ${taskId} not found`
        notifyListeners()
      } catch (e) {
        if (detailTaskId !== taskId) return
        const msg = e instanceof Error ? e.message : String(e)
        detailLoading = false
        detailError = `Detail fetch failed: ${msg}`
        notifyListeners()
      }
    },

    exitDetailView(): void {
      detailTaskId = undefined
      detailTask = undefined
      detailLoading = false
      detailError = undefined
      notifyListeners()
    },

    runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
      return run(effect)
    },

    startWorker(): void {
      if (workerFiber !== null) return

      // Fork the worker Effect as a daemon fiber on the controller's managed
      // runtime. This guarantees the worker inherits the TUI-safe logger
      // layer — no default-runtime escape hatch.
      const workerEffect = deps.tuiWorkerEffect(
        {
          onStateChange: (status: WorkerStatus) => {
            workerStatus = status
            notifyListeners()
          },
          onLog: () => {
            // Worker logs are handled by the TUI logger layer, not callbacks.
          },
          onTaskComplete: () => {
            // Trigger a refresh so the task list updates after execution.
            void controller.refresh().catch(() => {
              // Refresh failure is non-fatal; the periodic timer will retry.
            })
          },
        },
        {
          pollIntervalMs: refreshIntervalMs,
          workerId,
          workDir,
          deps: deps.workerDeps,
        },
      )

      void managedRuntime.runPromise(
        Effect.gen(function* () {
          workerFiber = yield* Effect.forkDaemon(workerEffect)
        }),
      )
    },

    async startMarkReadyConsumer(): Promise<void> {
      if (markReadyQueue !== null) return // Already started

      // Create the unbounded Effect Queue through the managed runtime.
      markReadyQueue = await managedRuntime.runPromise(
        Queue.unbounded<MarkReadyQueueItem>(),
      )

      const queue = markReadyQueue

      // Fork the consumer as a daemon fiber on the managed runtime so it
      // inherits the TUI logger layer and survives the parent fiber's
      // completion. The fiber loops forever: take → process → refresh → repeat.
      // Queue.shutdown() during stop() will interrupt the Queue.take, ending
      // the loop cleanly.
      void managedRuntime.runPromise(
        Effect.forkDaemon(
          Effect.forever(
            Effect.gen(function* () {
              const item = yield* Queue.take(queue)

              // Execute mark-ready through the scoped runtime's layer.
              // Errors are silently swallowed — drain continues.
              yield* Effect.catchAll(
                deps.markTaskReady(item.id, item.labels),
                () => Effect.void,
              )

              // Remove from pending set and notify UI.
              markReadyPendingIds = new Set(
                [...markReadyPendingIds].filter((pid) => pid !== item.id),
              )
              notifyListeners()

              // Trigger a refresh so the task list updates after mark-ready.
              // Fire-and-forget — matches the current onDrain behavior.
              void controller.refresh().catch(() => {
                // Refresh failure is non-fatal; the periodic timer will retry.
              })
            }),
          ),
        ),
      )
    },

    async startEpicDeleteConsumer(): Promise<void> {
      if (epicDeleteQueue !== null) return // Already started

      epicDeleteQueue = await managedRuntime.runPromise(
        Queue.unbounded<EpicDeleteQueueItem>(),
      )

      const queue = epicDeleteQueue

      // Fork the consumer as a daemon fiber. Each iteration:
      // 1. Take an epic ID from the queue
      // 2. Close the epic (Beads close + worktree cleanup)
      // 3. Remove from pending set
      // 4. Trigger refresh so the epic disappears from the TUI
      void managedRuntime.runPromise(
        Effect.forkDaemon(
          Effect.forever(
            Effect.gen(function* () {
              const item = yield* Queue.take(queue)

              // Execute closeEpic through the scoped runtime's layer.
              // Errors are silently swallowed — drain continues.
              yield* Effect.catchAll(
                deps.closeEpic(item.id, "epic deleted via TUI"),
                () => Effect.void,
              )

              // Remove from pending set and notify UI.
              epicDeletePendingIds = new Set(
                [...epicDeletePendingIds].filter((pid) => pid !== item.id),
              )
              notifyListeners()

              // Trigger a refresh so the epic disappears from the TUI.
              void controller.refresh().catch(() => {
                // Refresh failure is non-fatal; the periodic timer will retry.
              })
            }),
          ),
        ),
      )
    },

    startPeriodicRefresh(): void {
      if (refreshFiber !== null) return
      if (refreshIntervalMs <= 0) return

      // Fork the periodic refresh as a daemon fiber instead of a setInterval.
      // The fiber sleeps, then refreshes, forever — interrupted cleanly via
      // Fiber.interrupt during stop() or runtime disposal.
      void managedRuntime.runPromise(
        Effect.gen(function* () {
          refreshFiber = yield* Effect.forkDaemon(
            Effect.forever(
              Effect.gen(function* () {
                yield* Effect.sleep(refreshIntervalMs)
                yield* Effect.promise(() =>
                  controller.refresh().catch(() => {
                    // Non-fatal; error captured in refreshError state.
                  }),
                )
              }),
            ),
          )
        }),
      )
    },

    async stop(): Promise<void> {
      // Interrupt the worker fiber — the interrupt is delivered at the next
      // Effect operator (sleep, yield*, etc.), cleanly stopping the poll loop.
      if (workerFiber !== null) {
        await managedRuntime.runPromise(Fiber.interrupt(workerFiber))
        workerFiber = null
      }

      // Interrupt the periodic refresh fiber.
      if (refreshFiber !== null) {
        await managedRuntime.runPromise(Fiber.interrupt(refreshFiber))
        refreshFiber = null
      }

      // Shut down the mark-ready queue — this interrupts the consumer fiber's
      // Queue.take, causing the forever loop to exit cleanly.
      if (markReadyQueue !== null) {
        await managedRuntime.runPromise(Queue.shutdown(markReadyQueue))
        markReadyQueue = null
      }

      // Shut down the epic-delete queue similarly.
      if (epicDeleteQueue !== null) {
        await managedRuntime.runPromise(Queue.shutdown(epicDeleteQueue))
        epicDeleteQueue = null
      }

      await managedRuntime.dispose()
    },

    onStateChange(listener: () => void): void {
      listeners.push(listener)
    },

    removeStateChangeListener(listener: () => void): void {
      const idx = listeners.indexOf(listener)
      if (idx !== -1) listeners.splice(idx, 1)
    },
  }

  return controller
}
