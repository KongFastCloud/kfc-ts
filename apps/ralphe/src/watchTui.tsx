/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI entrypoint.
 * Bootstraps the .beads database if missing, creates a
 * TuiWatchController for scoped runtime ownership, runs
 * initial task load through the controller, and mounts a
 * single WatchSession boundary. The session component
 * subscribes to controller state changes from inside React
 * so updates flow through normal reconciliation — preserving
 * local dashboard state (selection, scroll, view mode) across
 * background refreshes. Periodic refresh, worker lifecycle, and
 * all refresh paths (initial, periodic, manual, post-task) are
 * managed by the controller.
 *
 * All watch-mode Effect operations are funnelled through the
 * controller's ManagedRuntime to guarantee consistent TUI logging
 * and eliminate scattered bare Effect.runPromise calls. Mark-ready
 * operations are serialized through an Effect-native queue owned
 * by the controller.
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Effect, Layer } from "effect"
import { FatalError } from "./errors.js"
import { ensureBeadsDatabase } from "./beadsAdapter.js"
import { WatchSession } from "./tui/WatchSession.js"
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
 * 2. Creates a TuiWatchController that owns the scoped TUI runtime.
 * 3. Loads initial tasks through the controller's runtime.
 * 4. Creates an OpenTUI renderer and mounts a single WatchSession boundary.
 * 5. Starts the controller's worker loop, mark-ready consumer, and periodic refresh.
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

    // 2. Create the scoped controller — single runtime owner for the TUI session
    const controller: TuiWatchController = createTuiWatchController(
      runtimeLayer,
      { refreshIntervalMs, workDir },
    )

    // 3. Initial load — runs through the controller's scoped runtime
    yield* Effect.promise(() => controller.initialLoad())

    // 4. Start consumer fibers (must happen before first render
    //    so that enqueue operations are safe to call from React callbacks).
    yield* Effect.promise(() => controller.startMarkReadyConsumer())
    yield* Effect.promise(() => controller.startEpicDeleteConsumer())

    // 5. Create renderer and mount the session boundary once.
    // WatchSession subscribes to controller state changes from inside React,
    // so the app tree updates through normal reconciliation — local dashboard
    // state (selection, scroll, view mode) is preserved across refreshes.
    const renderer = yield* Effect.promise(() => createCliRenderer())
    const root = createRoot(renderer)

    root.render(
      <WatchSession controller={controller} workDir={workDir} />,
    )

    // 6. Start the in-process worker and periodic refresh via the controller
    controller.startWorker()
    controller.startPeriodicRefresh()

    yield* Effect.logInfo(`Watch TUI started. Press 'q' to quit.`)

    // 7. Keep the process alive until interrupted
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
