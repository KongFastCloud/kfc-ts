/**
 * ABOUTME: In-TUI single-worker execution controller.
 * Runs a serialized poll→claim→execute→close loop inside the TUI process,
 * streaming logs and state updates to the UI via callbacks.
 *
 * Delegates core task lifecycle (metadata I/O, execution, finalization) to
 * the shared watchWorkflow so domain logic is not duplicated.
 */

import os from "node:os"
import { Effect } from "effect"
import { loadConfig } from "./config.js"
import { queryQueued } from "./beadsAdapter.js"
import {
  claimTask,
  recoverStaleTasks,
} from "./beads.js"
import { isWorktreeDirty } from "./git.js"
import { processClaimedTask, type ProcessTaskResult } from "./watchWorkflow.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerState = "idle" | "running"

export interface WorkerStatus {
  readonly state: WorkerState
  /** ID of the task currently executing, if any. */
  readonly currentTaskId?: string | undefined
}

export interface WorkerLogEntry {
  readonly timestamp: Date
  readonly message: string
  /** Task ID context, present during task execution. */
  readonly taskId?: string | undefined
}

export interface TuiWorkerCallbacks {
  /** Called when the worker state changes. */
  readonly onStateChange: (status: WorkerStatus) => void
  /** Called when the worker emits a log line. */
  readonly onLog: (entry: WorkerLogEntry) => void
  /** Called after a task completes (success or failure) to trigger a task list refresh. */
  readonly onTaskComplete: () => void
}

export interface TuiWorkerOptions {
  /** Poll interval in milliseconds. Defaults to 10_000. */
  readonly pollIntervalMs?: number
  /** Worker ID. Defaults to hostname-based ID. */
  readonly workerId?: string
  /** Working directory. Defaults to process.cwd(). */
  readonly workDir?: string
  /**
   * Optional scoped Effect runner that delegates through a managed runtime
   * (e.g. the TUI controller's ManagedRuntime). When provided, all Effect
   * executions inside the worker loop use this runner instead of bare
   * Effect.runPromise, ensuring consistent logging and runtime configuration.
   *
   * Defaults to Effect.runPromise for backward compatibility.
   */
  readonly runEffect?: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}

// ---------------------------------------------------------------------------
// Worker controller
// ---------------------------------------------------------------------------

/**
 * Create and start a TUI worker that polls for ready tasks and executes them
 * one at a time, streaming logs and state updates to the UI.
 *
 * Returns a stop function that cleanly shuts down the worker after the
 * current task (if any) finishes.
 *
 * The core task lifecycle (metadata I/O, execution, finalization) is
 * delegated to the shared processClaimedTask workflow. TUI-specific
 * orchestration (callbacks, state transitions, stop flag) lives here.
 */
export function startTuiWorker(
  callbacks: TuiWorkerCallbacks,
  opts?: TuiWorkerOptions,
): { stop: () => void } {
  const pollIntervalMs = opts?.pollIntervalMs ?? 10_000
  const workerId = opts?.workerId ?? `ralphe-${os.hostname()}`
  const workDir = opts?.workDir ?? process.cwd()
  const run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A> =
    opts?.runEffect ?? (<A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect as Effect.Effect<A, never>))
  let stopped = false
  const log = (message: string, taskId?: string) => {
    callbacks.onLog({ timestamp: new Date(), message, taskId })
  }

  const setState = (state: WorkerState, taskId?: string) => {
    callbacks.onStateChange({ state, currentTaskId: taskId })
  }

  const workerLoop = async () => {
    log(`Worker starting (id: ${workerId})`)

    // Startup recovery
    try {
      const recovered = await run(recoverStaleTasks(workerId))
      if (recovered > 0) {
        log(`Recovered ${recovered} stale task(s) from previous run`)
        callbacks.onTaskComplete()
      }
    } catch (e) {
      log(`Recovery check failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Dirty-worktree guard: pause automatic pickup until the working tree is clean
    try {
      let dirty = await run(isWorktreeDirty())
      if (dirty) {
        log("Worktree has uncommitted changes — pausing automatic pickup.")
        while (dirty && !stopped) {
          await sleep(pollIntervalMs)
          dirty = await run(isWorktreeDirty())
        }
        if (!stopped) {
          log("Worktree is clean — resuming automatic pickup.")
        }
      }
    } catch (e) {
      log(`Worktree check failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    log("Worker ready, polling for tasks...")
    setState("idle")

    while (!stopped) {
      const config = loadConfig(workDir)

      try {
        // Poll for queued tasks (open + ready + not blocked)
        const ready = await run(queryQueued(workDir))

        if (ready.length === 0) {
          await sleep(pollIntervalMs)
          continue
        }

        const issue = ready[0]!
        log(`Found ready task: ${issue.id} — ${issue.title}`, issue.id)

        // Claim atomically
        let claimed: boolean
        try {
          claimed = await run(claimTask(issue.id))
        } catch (e) {
          log(`Failed to claim task ${issue.id}: ${e instanceof Error ? e.message : String(e)}`, issue.id)
          continue
        }

        if (!claimed) {
          log(`Task ${issue.id} already claimed by another worker, skipping`, issue.id)
          continue
        }

        log(`Claimed task: ${issue.id}`, issue.id)
        setState("running", issue.id)

        // Delegate to the shared task lifecycle workflow
        log(`Executing task ${issue.id}...`, issue.id)
        let result: ProcessTaskResult
        try {
          result = await run(
            processClaimedTask(issue, config, workerId),
          )
        } catch (e) {
          // processClaimedTask catches its own errors via runTask,
          // but guard against unexpected throws
          log(`Task ${issue.id} threw unexpectedly: ${e instanceof Error ? e.message : String(e)}`, issue.id)
          setState("idle")
          callbacks.onTaskComplete()
          continue
        }

        if (result.success) {
          log(`Task ${issue.id} completed successfully`, issue.id)
        } else {
          log(`Task ${issue.id} exhausted all retries — marked as error (task remains open)`, issue.id)
        }

        setState("idle")
        callbacks.onTaskComplete()
      } catch (e) {
        // Top-level catch: adapter/engine errors should not crash the worker
        log(`Worker error: ${e instanceof Error ? e.message : String(e)}`)
        setState("idle")
        await sleep(pollIntervalMs)
      }
    }

    log("Worker stopped")
  }

  // Start the loop (fire-and-forget — runs async alongside the TUI)
  void workerLoop()

  return {
    stop: () => {
      stopped = true
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
