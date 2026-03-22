/**
 * ABOUTME: Scoped TUI watch controller — runtime owner for watch-mode state,
 * commands, and lifecycle. All watch-mode Effect operations run through a
 * single ManagedRuntime configured with TuiLoggerLayer, ensuring consistent
 * logging and eliminating scattered bare Effect.runPromise calls.
 *
 * React and OpenTUI remain adapter consumers of controller state and commands.
 * Promise-returning UI callbacks delegate through the controller's runtime.
 */

import os from "node:os"
import { Effect, ManagedRuntime, type Layer } from "effect"
import type { WatchTask } from "./beadsAdapter.js"
import { queryAllTasks } from "./beadsAdapter.js"
import { markTaskReady } from "./beads.js"
import type { WorkerStatus } from "./tuiWorker.js"
import { startTuiWorker } from "./tuiWorker.js"
import { loadConfig } from "./config.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Observable snapshot of the controller's state.
 * UI components read this to render; the controller is the single owner.
 */
export interface TuiWatchControllerState {
  readonly workerStatus: WorkerStatus
  readonly latestTasks: WatchTask[]
  readonly refreshError: string | undefined
}

export interface TuiWatchControllerOptions {
  /** Poll / refresh interval in milliseconds. Default 10_000. */
  readonly refreshIntervalMs?: number
  /** Working directory. Default process.cwd(). */
  readonly workDir?: string
  /** Worker ID. Default hostname-based. */
  readonly workerId?: string
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
  /** Refresh the task list. Returns updated tasks. */
  refresh(): Promise<WatchTask[]>
  /** Mark a task as ready. */
  markReady(id: string, labels: string[]): Promise<void>
  /**
   * Run an arbitrary Effect through the controller's scoped runtime.
   * Intended for one-off operations that must share the TUI logger and
   * runtime configuration. Typed errors are surfaced as rejections.
   */
  runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A>

  // -- Lifecycle ------------------------------------------------------------
  /** Start the worker loop. */
  startWorker(): void
  /** Stop the worker and dispose the managed runtime. */
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
  let workerHandle: { stop: () => void } | null = null

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
      return { workerStatus, latestTasks, refreshError }
    },

    async refresh(): Promise<WatchTask[]> {
      try {
        const tasks = await run(queryAllTasks(workDir))
        latestTasks = tasks
        refreshError = undefined
        notifyListeners()
        return tasks
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        refreshError = `Refresh failed: ${msg}`
        notifyListeners()
        throw e
      }
    },

    async markReady(id: string, labels: string[]): Promise<void> {
      await run(markTaskReady(id, labels))
    },

    runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
      return run(effect)
    },

    startWorker(): void {
      if (workerHandle !== null) return

      workerHandle = startTuiWorker(
        {
          onStateChange: (status) => {
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
        },
      )
    },

    async stop(): Promise<void> {
      workerHandle?.stop()
      workerHandle = null
      await managedRuntime.dispose()
    },

    onStateChange(listener: () => void): void {
      listeners.push(listener)
    },
  }

  return controller
}
