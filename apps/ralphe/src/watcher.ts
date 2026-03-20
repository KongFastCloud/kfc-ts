import os from "node:os"
import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { loadConfig } from "./config.js"
import { runTask } from "./runTask.js"
import { queryQueued } from "./beadsAdapter.js"
import {
  claimTask,
  closeTaskSuccess,
  writeMetadata,
  readMetadata,
  buildPromptFromIssue,
  recoverStaleTasks,
  markTaskExhaustedFailure,
  type BeadsMetadata,
} from "./beads.js"
import { isWorktreeDirty } from "./git.js"

export interface WatcherOptions {
  /** Poll interval in milliseconds. Defaults to 10_000 (10 seconds). */
  readonly pollIntervalMs?: number
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
    yield* Effect.logInfo(`Beads watcher starting`)

    // Startup recovery: handle stale claimed tasks
    const recovered = yield* recoverStaleTasks(workerId)
    if (recovered > 0) {
      yield* Effect.logInfo(`Recovered ${recovered} stale task(s) from previous run`)
    }

    // Dirty-worktree guard: pause automatic pickup until the working tree is clean
    const dirty = yield* isWorktreeDirty()
    if (dirty) {
      yield* Effect.logWarning("Worktree has uncommitted changes — pausing automatic pickup.")
      yield* Effect.iterate(true as boolean, {
        while: (isDirty) => isDirty,
        body: () =>
          Effect.gen(function* () {
            yield* Effect.sleep(pollIntervalMs)
            return yield* isWorktreeDirty()
          }),
      })
      yield* Effect.logDebug("Worktree is clean — resuming automatic pickup.")
    }

    let tasksProcessed = 0

    yield* Effect.iterate(true as boolean, {
      while: (running) => running,
      body: () =>
        Effect.gen(function* () {
          const config = loadConfig(workDir)

          // Check task limit
          if (maxTasks !== undefined && tasksProcessed >= maxTasks) {
            yield* Effect.logInfo(`Reached task limit (${maxTasks}). Stopping.`)
            return false
          }

          // Poll for queued tasks (open + ready + no error + not blocked)
          const ready = yield* queryQueued(workDir)

          if (ready.length === 0) {
            yield* Effect.sleep(pollIntervalMs)
            return true
          }

          const issue = ready[0]!
          yield* Effect.logInfo(`Found ready task: ${issue.id} — ${issue.title}`)

          // Claim atomically
          const claimed = yield* claimTask(issue.id)
          if (!claimed) {
            yield* Effect.logDebug(`Task ${issue.id} already claimed by another worker. Skipping.`)
            return true
          }

          yield* Effect.logInfo(`Claimed task: ${issue.id}`)

          // Process task with annotations and span
          const processTask = Effect.gen(function* () {
            // Read existing metadata before overwriting to capture previous error
            const existingMeta = yield* Effect.either(readMetadata(issue.id))
            const previousError = existingMeta._tag === "Right" ? existingMeta.right?.error : undefined

            // Write initial metadata
            const startedAt = new Date().toISOString()
            const startMetadata: BeadsMetadata = {
              engine: config.engine,
              workerId,
              timestamp: startedAt,
              startedAt,
            }
            yield* writeMetadata(issue.id, startMetadata)

            // Build prompt and execute
            let prompt = buildPromptFromIssue(issue)
            if (previousError) {
              prompt += `\n\n## Previous Error\n${previousError}`
            }
            const result = yield* runTask(prompt, config, { issueId: issue.id })

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
              yield* Effect.logInfo(`Task completed successfully.`)
            } else {
              // Exhausted failure: keep task open, remove eligibility, mark error
              yield* markTaskExhaustedFailure(
                issue.id,
                result.error ?? "execution failed",
                finalMetadata,
              )
              yield* Effect.logWarning(`Task exhausted all retries — marked as error (task remains open).`)
            }
          }).pipe(
            Effect.annotateLogs({ taskId: issue.id, issueTitle: issue.title }),
            Effect.withLogSpan("task"),
          )

          yield* processTask

          tasksProcessed++
          return true
        }),
    })

    yield* Effect.logInfo("Beads watcher stopped.")
  }).pipe(
    Effect.annotateLogs({ workerId }),
  )
}
