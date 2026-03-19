/**
 * ABOUTME: In-TUI single-worker execution controller.
 * Runs a serialized poll→claim→execute→close loop inside the TUI process,
 * streaming logs and state updates to the UI via callbacks.
 */

import os from "node:os"
import { Effect } from "effect"
import { loadConfig } from "./config.js"
import { runTask, type TaskResult } from "./runTask.js"
import { queryActionable } from "./beadsAdapter.js"
import {
  claimTask,
  closeTaskSuccess,
  writeMetadata,
  buildPromptFromIssue,
  recoverStaleTasks,
  markTaskExhaustedFailure,
  type BeadsMetadata,
} from "./beads.js"

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
  /** Engine override. If not set, uses config. */
  readonly engineOverride?: "claude" | "codex"
  /** Worker ID. Defaults to hostname-based ID. */
  readonly workerId?: string
  /** Working directory. Defaults to process.cwd(). */
  readonly workDir?: string
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
 */
export function startTuiWorker(
  callbacks: TuiWorkerCallbacks,
  opts?: TuiWorkerOptions,
): { stop: () => void } {
  const pollIntervalMs = opts?.pollIntervalMs ?? 10_000
  const workerId = opts?.workerId ?? `ralphe-${os.hostname()}`
  const workDir = opts?.workDir ?? process.cwd()
  const engineOverride = opts?.engineOverride

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
      const recovered = await Effect.runPromise(recoverStaleTasks(workerId))
      if (recovered > 0) {
        log(`Recovered ${recovered} stale task(s) from previous run`)
        callbacks.onTaskComplete()
      }
    } catch (e) {
      log(`Recovery check failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    const config = loadConfig(workDir)

    log("Worker ready, polling for tasks...")
    setState("idle")

    while (!stopped) {
      try {
        // Poll for actionable tasks (open + ready + no error + not blocked)
        const ready = await Effect.runPromise(queryActionable(workDir))

        if (ready.length === 0) {
          await sleep(pollIntervalMs)
          continue
        }

        const issue = ready[0]!
        log(`Found ready task: ${issue.id} — ${issue.title}`, issue.id)

        // Claim atomically
        let claimed: boolean
        try {
          claimed = await Effect.runPromise(claimTask(issue.id))
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

        // Write initial metadata
        const startMetadata: BeadsMetadata = {
          engine: engineOverride ?? config.engine,
          workerId,
          timestamp: new Date().toISOString(),
        }
        try {
          await Effect.runPromise(writeMetadata(issue.id, startMetadata))
        } catch (e) {
          log(`Failed to write metadata for ${issue.id}: ${e instanceof Error ? e.message : String(e)}`, issue.id)
        }

        // Build prompt and execute
        const prompt = buildPromptFromIssue(issue)
        log(`Executing task ${issue.id}...`, issue.id)

        let result: TaskResult
        try {
          result = await Effect.runPromise(
            runTask(prompt, config, { engineOverride }),
          )
        } catch (e) {
          // runTask catches its own errors and returns TaskResult,
          // but guard against unexpected throws
          log(`Task ${issue.id} threw unexpectedly: ${e instanceof Error ? e.message : String(e)}`, issue.id)
          result = {
            success: false,
            engine: engineOverride ?? config.engine,
            error: e instanceof Error ? e.message : String(e),
          }
        }

        // Write final metadata and finalize
        const finalMetadata: BeadsMetadata = {
          engine: result.engine,
          resumeToken: result.resumeToken,
          workerId,
          timestamp: new Date().toISOString(),
        }

        if (result.success) {
          try {
            await Effect.runPromise(writeMetadata(issue.id, finalMetadata))
            await Effect.runPromise(closeTaskSuccess(issue.id))
            log(`Task ${issue.id} completed successfully`, issue.id)
          } catch (e) {
            log(`Failed to close task ${issue.id} as success: ${e instanceof Error ? e.message : String(e)}`, issue.id)
          }
        } else {
          // Exhausted failure: keep task open, remove eligibility, mark error
          try {
            await Effect.runPromise(
              markTaskExhaustedFailure(
                issue.id,
                result.error ?? "execution failed",
                finalMetadata,
              ),
            )
            log(`Task ${issue.id} exhausted all retries — marked as error (task remains open)`, issue.id)
          } catch (e) {
            log(`Failed to mark task ${issue.id} as error: ${e instanceof Error ? e.message : String(e)}`, issue.id)
          }
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
