import os from "node:os"
import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"
import { loadConfig } from "./config.js"
import { runTask } from "./runTask.js"
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
import { isWorktreeDirty } from "./git.js"

export interface WatcherOptions {
  /** Poll interval in milliseconds. Defaults to 10_000 (10 seconds). */
  readonly pollIntervalMs?: number
  /** Engine override. If not set, uses config. */
  readonly engineOverride?: "claude" | "codex"
  /** Worker ID. Defaults to hostname. */
  readonly workerId?: string
  /** Maximum number of tasks to process before stopping. Undefined = run forever. */
  readonly maxTasks?: number
  /** Working directory. Defaults to process.cwd(). */
  readonly workDir?: string
}

/**
 * Generate a default worker ID from hostname.
 */
export const defaultWorkerId = (): string =>
  `ralphe-${os.hostname()}`

/**
 * Run the Beads watcher loop.
 * Continuously polls for ready tasks, claims one, executes it, and writes results back.
 */
export const watch = (
  opts?: WatcherOptions,
): Effect.Effect<void, FatalError> => {
  const pollIntervalMs = opts?.pollIntervalMs ?? 10_000
  const workerId = opts?.workerId ?? defaultWorkerId()
  const maxTasks = opts?.maxTasks
  const workDir = opts?.workDir ?? process.cwd()

  return Effect.gen(function* () {
    yield* Console.log(`Beads watcher starting (worker: ${workerId})`)

    // Startup recovery: handle stale claimed tasks
    const recovered = yield* recoverStaleTasks(workerId)
    if (recovered > 0) {
      yield* Console.log(`Recovered ${recovered} stale task(s) from previous run`)
    }

    // Dirty-worktree guard: pause automatic pickup until the working tree is clean
    const dirty = yield* isWorktreeDirty()
    if (dirty) {
      yield* Console.log("Worktree has uncommitted changes — pausing automatic pickup.")
      yield* Effect.iterate(true as boolean, {
        while: (isDirty) => isDirty,
        body: () =>
          Effect.gen(function* () {
            yield* Effect.sleep(pollIntervalMs)
            return yield* isWorktreeDirty()
          }),
      })
      yield* Console.log("Worktree is clean — resuming automatic pickup.")
    }

    const config = loadConfig(workDir)
    let tasksProcessed = 0

    yield* Effect.iterate(true as boolean, {
      while: (running) => running,
      body: () =>
        Effect.gen(function* () {
          // Check task limit
          if (maxTasks !== undefined && tasksProcessed >= maxTasks) {
            yield* Console.log(`Reached task limit (${maxTasks}). Stopping.`)
            return false
          }

          // Poll for actionable tasks (open + ready + no error + not blocked)
          const ready = yield* queryActionable(workDir)

          if (ready.length === 0) {
            yield* Effect.sleep(pollIntervalMs)
            return true
          }

          const issue = ready[0]!
          yield* Console.log(`\nFound ready task: ${issue.id} — ${issue.title}`)

          // Claim atomically
          const claimed = yield* claimTask(issue.id)
          if (!claimed) {
            yield* Console.log(`Task ${issue.id} already claimed by another worker. Skipping.`)
            return true
          }

          yield* Console.log(`Claimed task: ${issue.id}`)

          // Write initial metadata
          const startedAt = new Date().toISOString()
          const startMetadata: BeadsMetadata = {
            engine: opts?.engineOverride ?? config.engine,
            workerId,
            timestamp: startedAt,
            startedAt,
          }
          yield* writeMetadata(issue.id, startMetadata)

          // Build prompt and execute
          const prompt = buildPromptFromIssue(issue)
          const result = yield* runTask(prompt, config, {
            engineOverride: opts?.engineOverride,
          })

          // Write final metadata with resume token
          const finishedAt = new Date().toISOString()
          const finalMetadata: BeadsMetadata = {
            engine: result.engine,
            resumeToken: result.resumeToken,
            workerId,
            timestamp: finishedAt,
            startedAt,
            finishedAt,
          }

          // Close with appropriate outcome
          if (result.success) {
            yield* writeMetadata(issue.id, finalMetadata)
            yield* closeTaskSuccess(issue.id)
            yield* Console.log(`Task ${issue.id} completed successfully.`)
          } else {
            // Exhausted failure: keep task open, remove eligibility, mark error
            yield* markTaskExhaustedFailure(
              issue.id,
              result.error ?? "execution failed",
              finalMetadata,
            )
            yield* Console.log(`Task ${issue.id} exhausted all retries — marked as error (task remains open).`)
          }

          tasksProcessed++
          return true
        }),
    })

    yield* Console.log("Beads watcher stopped.")
  })
}
