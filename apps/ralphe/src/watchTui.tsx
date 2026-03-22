/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI entrypoint.
 * Initializes the OpenTUI renderer, loads Beads tasks,
 * bootstraps the .beads database if missing, creates a
 * TuiWatchController for scoped runtime ownership, and
 * renders the WatchApp component with periodic refresh.
 *
 * All watch-mode Effect operations are funnelled through the
 * controller's ManagedRuntime to guarantee consistent TUI logging
 * and eliminate scattered bare Effect.runPromise calls.
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Effect, Layer } from "effect"
import { FatalError } from "./errors.js"
import {
  ensureBeadsDatabase,
  queryAllTasks,
  type WatchTask,
} from "./beadsAdapter.js"
import { WatchApp } from "./tui/WatchApp.js"
import { loadConfig } from "./config.js"
import { TuiLoggerLayer } from "./logger.js"
import {
  createTuiWatchController,
  type TuiWatchController,
} from "./tuiWatchController.js"

export interface WatchTuiOptions {
  /** Poll interval in milliseconds for Beads refresh. Default 10_000. */
  readonly refreshIntervalMs?: number
  /** Working directory. Default process.cwd(). */
  readonly workDir?: string
  /**
   * Optional layer override for the controller's ManagedRuntime.
   * Defaults to TuiLoggerLayer. Useful for testing.
   */
  readonly runtimeLayer?: Layer.Layer<never>
}

/**
 * Launch the watch-mode TUI.
 * This Effect:
 * 1. Ensures the .beads database exists (bootstrap if missing).
 * 2. Loads the initial task list.
 * 3. Creates a TuiWatchController that owns the scoped TUI runtime.
 * 4. Creates an OpenTUI renderer and mounts WatchApp.
 * 5. Starts the controller's worker loop.
 * 6. Blocks until the user quits (Ctrl-C / q).
 */
export const launchWatchTui = (
  opts?: WatchTuiOptions,
): Effect.Effect<void, FatalError> => {
  const refreshIntervalMs = opts?.refreshIntervalMs ?? 10_000
  const workDir = opts?.workDir ?? process.cwd()
  const runtimeLayer = opts?.runtimeLayer ?? TuiLoggerLayer

  return Effect.gen(function* () {
    // 1. Ensure .beads database
    const dbMessage = yield* ensureBeadsDatabase(workDir)
    yield* Effect.logInfo(dbMessage)

    // 2. Load initial tasks
    let initialTasks: WatchTask[] = []
    let initialError: string | undefined

    const loadResult = yield* Effect.either(queryAllTasks(workDir))
    if (loadResult._tag === "Right") {
      initialTasks = loadResult.right
    } else {
      initialError = `Could not load tasks: ${loadResult.left.message}`
      yield* Effect.logWarning(initialError)
    }

    // 3. Create the scoped controller — single runtime owner for the TUI session
    const controller: TuiWatchController = createTuiWatchController(
      runtimeLayer,
      { refreshIntervalMs, workDir },
    )

    // Seed controller with initial tasks via its state
    // (The controller's latestTasks start empty; the initial load runs in
    //  the parent Effect scope before the controller is created.)

    // 4. Create renderer and render
    const renderer = yield* Effect.promise(() => createCliRenderer())
    const root = createRoot(renderer)

    // Re-render helper — reads latest state from the controller each time
    const rerender = () => {
      const config = loadConfig(workDir)
      const state = controller.getState()
      root.render(
        <WatchApp
          initialTasks={state.latestTasks.length > 0 ? state.latestTasks : initialTasks}
          onRefresh={() => controller.refresh()}
          onMarkReady={(id, labels) => controller.markReady(id, labels)}
          refreshIntervalMs={refreshIntervalMs}
          initialError={state.refreshError ?? initialError}
          workerStatus={state.workerStatus}
          config={config}
        />,
      )
    }

    // Subscribe to controller state changes → re-render
    controller.onStateChange(rerender)

    // 5. Start the in-process worker via the controller
    controller.startWorker()

    // Initial render
    rerender()

    yield* Effect.logInfo(`Watch TUI started. Press 'q' to quit.`)

    // 6. Keep the process alive until interrupted
    yield* Effect.async<void, never>(() => {
      // This Effect never resolves — the TUI owns the process lifecycle.
      // process.exit() is called from WatchApp's quit handler.
      // Clean up controller on process exit.
      process.on("exit", () => {
        void controller.stop()
      })
    })
  })
}
