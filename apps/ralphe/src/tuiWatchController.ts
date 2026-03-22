/**
 * ABOUTME: Scoped TUI watch controller — runtime owner for watch-mode state,
 * commands, and lifecycle. All watch-mode Effect operations run through a
 * single ManagedRuntime configured with TuiLoggerLayer, ensuring consistent
 * logging and eliminating scattered bare Effect.runPromise calls.
 *
 * The worker runs as Effect-managed orchestration (tuiWorkerEffect) via
 * startTuiWorker, which internally forks the Effect-based worker as a fiber.
 * The mark-ready consumer and periodic refresh run as daemon fibers inside
 * the managed runtime. Shutdown is driven by fiber interruption, worker stop,
 * and queue shutdown.
 *
 * Mark-ready operations are serialized through an Effect-native Queue owned
 * by the controller. The queue preserves FIFO ordering and non-blocking
 * enqueue semantics. A consumer fiber drains the queue inside the managed
 * runtime, ensuring consistent logging and error handling.
 *
 * React and OpenTUI remain adapter consumers of controller state and commands.
 * Promise-returning UI callbacks delegate through the controller's runtime.
 */

import os from "node:os"
import { Effect, Fiber, ManagedRuntime, Queue, type Layer } from "effect"
import type { WatchTask } from "./beadsAdapter.js"
import { queryAllTasks } from "./beadsAdapter.js"
import { markTaskReady } from "./beads.js"
import type { WorkerStatus } from "./tuiWorker.js"
import { startTuiWorker } from "./tuiWorker.js"
import { loadConfig } from "./config.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A mark-ready queue item — the task ID and its current labels. */
export interface MarkReadyQueueItem {
  readonly id: string
  readonly labels: string[]
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
  readonly markTaskReady: typeof markTaskReady
  readonly startTuiWorker: typeof startTuiWorker
  readonly loadConfig: typeof loadConfig
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
    markTaskReady,
    startTuiWorker,
    loadConfig,
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
  let workerHandle: { stop: () => void } | null = null
  let refreshInFlight = false

  // -- Fiber handles -------------------------------------------------------
  let refreshFiber: Fiber.RuntimeFiber<void, never> | null = null

  // -- Mark-ready queue state -----------------------------------------------
  let markReadyQueue: Queue.Queue<MarkReadyQueueItem> | null = null
  let markReadyPendingIds = new Set<string>()

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

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const controller: TuiWatchController = {
    getState(): TuiWatchControllerState {
      return { workerStatus, latestTasks, refreshError, lastRefreshed, markReadyPendingIds }
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
        notifyListeners()
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

    runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
      return run(effect)
    },

    startWorker(): void {
      if (workerHandle !== null) return

      // Start the Effect-based worker via startTuiWorker, which internally
      // forks tuiWorkerEffect as a fiber. The worker's Effects are routed
      // through the controller's managed runtime via runEffect.
      workerHandle = deps.startTuiWorker(
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
          runEffect: run,
        },
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
      // Stop the worker — internally interrupts the Effect-based worker fiber.
      workerHandle?.stop()
      workerHandle = null

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

      await managedRuntime.dispose()
    },

    onStateChange(listener: () => void): void {
      listeners.push(listener)
    },
  }

  return controller
}
