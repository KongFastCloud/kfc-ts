import os from "node:os"
import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { recoverStaleTasks } from "./beads.js"
import { isWorktreeDirty } from "./git.js"
import { pollClaimAndProcess } from "./watchWorkflow.js"

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
 *
 * Uses the shared watch-task workflow for the core poll/claim/execute/finalize
 * pipeline. Headless-specific orchestration (startup recovery, dirty-worktree
 * guard, poll loop with sleep, task limit) lives here.
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
          // Check task limit
          if (maxTasks !== undefined && tasksProcessed >= maxTasks) {
            yield* Effect.logInfo(`Reached task limit (${maxTasks}). Stopping.`)
            return false
          }

          const result = yield* pollClaimAndProcess(workDir, workerId)

          switch (result._tag) {
            case "NoneReady":
              yield* Effect.sleep(pollIntervalMs)
              break
            case "ClaimContention":
              // Another worker claimed it — continue to next poll
              break
            case "Processed":
              tasksProcessed++
              break
          }

          return true
        }),
    })

    yield* Effect.logInfo("Beads watcher stopped.")
  }).pipe(
    Effect.annotateLogs({ workerId }),
  )
}
