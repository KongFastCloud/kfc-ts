/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI entrypoint.
 * Initializes the OpenTUI renderer, loads Beads tasks,
 * bootstraps the .beads database if missing, starts an
 * in-process worker loop, and renders the WatchApp component
 * with periodic refresh.
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"
import {
  ensureBeadsDatabase,
  queryAllTasks,
  type WatchTask,
} from "./beadsAdapter.js"
import { WatchApp } from "./tui/WatchApp.js"
import {
  startTuiWorker,
  type WorkerStatus,
} from "./tuiWorker.js"
import { loadConfig } from "./config.js"

export interface WatchTuiOptions {
  /** Poll interval in milliseconds for Beads refresh. Default 10_000. */
  readonly refreshIntervalMs?: number
  /** Working directory. Default process.cwd(). */
  readonly workDir?: string
}

/**
 * Launch the watch-mode TUI.
 * This Effect:
 * 1. Ensures the .beads database exists (bootstrap if missing).
 * 2. Loads the initial task list.
 * 3. Creates an OpenTUI renderer and mounts WatchApp.
 * 4. Starts an in-process worker that polls and executes tasks.
 * 5. Blocks until the user quits (Ctrl-C / q).
 */
export const launchWatchTui = (
  opts?: WatchTuiOptions,
): Effect.Effect<void, FatalError> => {
  const refreshIntervalMs = opts?.refreshIntervalMs ?? 10_000
  const workDir = opts?.workDir ?? process.cwd()

  return Effect.gen(function* () {
    // 1. Ensure .beads database
    const dbMessage = yield* ensureBeadsDatabase(workDir)
    yield* Console.log(dbMessage)

    // 2. Load initial tasks
    let initialTasks: WatchTask[] = []
    let initialError: string | undefined

    const loadResult = yield* Effect.either(queryAllTasks(workDir))
    if (loadResult._tag === "Right") {
      initialTasks = loadResult.right
    } else {
      initialError = `Could not load tasks: ${loadResult.left.message}`
      yield* Console.log(`Warning: ${initialError}`)
    }

    // 3. Create renderer and render
    const renderer = yield* Effect.promise(() => createCliRenderer())
    const root = createRoot(renderer)

    // -----------------------------------------------------------------------
    // Worker state — held outside React so callbacks can mutate and re-render
    // -----------------------------------------------------------------------
    let currentWorkerStatus: WorkerStatus = { state: "idle" }

    // Re-render helper — captures latest state each time
    const rerender = () => {
      const config = loadConfig(workDir)
      root.render(
        <WatchApp
          initialTasks={latestTasks}
          onRefresh={onRefresh}
          refreshIntervalMs={refreshIntervalMs}
          initialError={initialError}
          workerStatus={currentWorkerStatus}
          config={config}
        />,
      )
    }

    // Refresh callback for the TUI (runs outside Effect)
    const onRefresh = async (): Promise<WatchTask[]> => {
      const tasks = await Effect.runPromise(queryAllTasks(workDir))
      latestTasks = tasks
      return tasks
    }

    // Track latest tasks for re-render
    let latestTasks = initialTasks

    // -----------------------------------------------------------------------
    // 4. Start the in-process worker
    // -----------------------------------------------------------------------
    const worker = startTuiWorker(
      {
        onStateChange: (status) => {
          currentWorkerStatus = status
          rerender()
        },
        onLog: () => {
          // Worker logs are no longer displayed in the TUI.
        },
        onTaskComplete: () => {
          // Trigger a refresh so the task list updates after execution
          void onRefresh()
            .then((tasks) => {
              latestTasks = tasks
              rerender()
            })
            .catch(() => {
              // Refresh failure is non-fatal; the periodic timer will retry
            })
        },
      },
      {
        pollIntervalMs: refreshIntervalMs,
        workDir,
      },
    )

    // Initial render
    rerender()

    yield* Console.log(`Watch TUI started. Press 'q' to quit.`)

    // 5. Keep the process alive until interrupted
    yield* Effect.async<void, never>(() => {
      // This Effect never resolves — the TUI owns the process lifecycle.
      // process.exit() is called from WatchApp's quit handler.
      // Clean up worker on process exit.
      process.on("exit", () => {
        worker.stop()
      })
    })
  })
}
