/**
 * ABOUTME: Effect-native TUI worker — fiber-based poll→claim→execute loop.
 * Runs as an interruptible Effect inside the TUI controller's scoped runtime,
 * replacing the previous detached async loop with boolean-flag shutdown.
 *
 * Lifecycle is managed through fiber interruption: the controller forks this
 * Effect as a daemon fiber, and scope disposal or explicit Fiber.interrupt
 * cleanly stops the worker.
 *
 * Delegates core task lifecycle (metadata I/O, execution, finalization) to
 * the shared watchWorkflow so domain logic is not duplicated.
 */

import os from "node:os"
import { Effect, Fiber } from "effect"
import { loadConfig } from "./config.js"
import { queryQueued } from "./beadsAdapter.js"
import {
  claimTask,
  recoverStaleTasks,
} from "./beads.js"
import { isWorktreeDirty } from "./git.js"
import { processClaimedTask } from "./watchWorkflow.js"

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
  /** Test-only dependency overrides for deterministic worker behavior. */
  readonly deps?: Partial<TuiWorkerDeps>
}

export interface TuiWorkerDeps {
  readonly loadConfig: typeof loadConfig
  readonly queryQueued: typeof queryQueued
  readonly claimTask: typeof claimTask
  readonly recoverStaleTasks: typeof recoverStaleTasks
  readonly isWorktreeDirty: typeof isWorktreeDirty
  readonly processClaimedTask: typeof processClaimedTask
}

// ---------------------------------------------------------------------------
// Effect-based worker
// ---------------------------------------------------------------------------

/**
 * Effect-native TUI worker that polls for ready tasks and executes them
 * one at a time, streaming state updates to the UI via callbacks.
 *
 * Designed to be forked as a daemon fiber inside the TUI controller's
 * ManagedRuntime. Interruption (via Fiber.interrupt or scope disposal)
 * cleanly stops the worker — no boolean flags needed.
 *
 * The core task lifecycle (metadata I/O, execution, finalization) is
 * delegated to the shared processClaimedTask workflow. TUI-specific
 * orchestration (callbacks, state transitions) lives here.
 */
export const tuiWorkerEffect = (
  callbacks: TuiWorkerCallbacks,
  opts?: TuiWorkerOptions,
): Effect.Effect<void, never> => {
  const pollIntervalMs = opts?.pollIntervalMs ?? 10_000
  const workerId = opts?.workerId ?? `ralphe-${os.hostname()}`
  const workDir = opts?.workDir ?? process.cwd()
  const deps: TuiWorkerDeps = {
    loadConfig,
    queryQueued,
    claimTask,
    recoverStaleTasks,
    isWorktreeDirty,
    processClaimedTask,
    ...opts?.deps,
  }

  const log = (message: string, taskId?: string) => {
    callbacks.onLog({ timestamp: new Date(), message, taskId })
  }

  const setState = (state: WorkerState, taskId?: string) => {
    callbacks.onStateChange({ state, currentTaskId: taskId })
  }

  return Effect.gen(function* () {
    log(`Worker starting (id: ${workerId})`)

    // -----------------------------------------------------------------------
    // Startup recovery
    // -----------------------------------------------------------------------
    yield* Effect.catchAll(
      Effect.gen(function* () {
        const recovered = yield* deps.recoverStaleTasks(workerId)
        if (recovered > 0) {
          log(`Recovered ${recovered} stale task(s) from previous run`)
          callbacks.onTaskComplete()
        }
      }),
      (e) =>
        Effect.sync(() => {
          log(`Recovery check failed: ${e instanceof Error ? e.message : String(e)}`)
        }),
    )

    // -----------------------------------------------------------------------
    // Dirty-worktree guard: pause automatic pickup until clean
    // -----------------------------------------------------------------------
    yield* Effect.catchAll(
      Effect.gen(function* () {
        const dirty = yield* deps.isWorktreeDirty()
        if (dirty) {
          log("Worktree has uncommitted changes — pausing automatic pickup.")
          yield* Effect.iterate(true as boolean, {
            while: (isDirty) => isDirty,
            body: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(pollIntervalMs)
                return yield* deps.isWorktreeDirty()
              }),
          })
          log("Worktree is clean — resuming automatic pickup.")
        }
      }),
      (e) =>
        Effect.sync(() => {
          log(`Worktree check failed: ${e instanceof Error ? e.message : String(e)}`)
        }),
    )

    log("Worker ready, polling for tasks...")
    setState("idle")

    // -----------------------------------------------------------------------
    // Main polling loop — runs forever until the fiber is interrupted
    // -----------------------------------------------------------------------
    yield* Effect.forever(
      Effect.gen(function* () {
        const config = deps.loadConfig(workDir)

        // Poll for queued tasks (open + ready + not blocked)
        const ready = yield* deps.queryQueued(workDir)

        if (ready.length === 0) {
          yield* Effect.sleep(pollIntervalMs)
          return
        }

        const issue = ready[0]!
        log(`Found ready task: ${issue.id} — ${issue.title}`, issue.id)

        // Claim atomically — use Either to handle claim failures inline
        const claimResult = yield* Effect.either(deps.claimTask(issue.id))
        if (claimResult._tag === "Left") {
          const e = claimResult.left
          log(
            `Failed to claim task ${issue.id}: ${e instanceof Error ? e.message : String(e)}`,
            issue.id,
          )
          return
        }

        if (!claimResult.right) {
          log(`Task ${issue.id} already claimed by another worker, skipping`, issue.id)
          return
        }

        log(`Claimed task: ${issue.id}`, issue.id)
        setState("running", issue.id)

        // Delegate to the shared task lifecycle workflow
        log(`Executing task ${issue.id}...`, issue.id)
        const execResult = yield* Effect.either(
          deps.processClaimedTask(issue, config, workerId),
        )

        if (execResult._tag === "Left") {
          // processClaimedTask catches its own errors via runTask,
          // but guard against unexpected failures
          const e = execResult.left
          log(
            `Task ${issue.id} threw unexpectedly: ${e instanceof Error ? e.message : String(e)}`,
            issue.id,
          )
          setState("idle")
          callbacks.onTaskComplete()
          return
        }

        const result = execResult.right
        if (result.success) {
          log(`Task ${issue.id} completed successfully`, issue.id)
        } else {
          log(`Task ${issue.id} exhausted all retries — marked as error (task remains open)`, issue.id)
        }

        setState("idle")
        callbacks.onTaskComplete()
      }).pipe(
        // Catch typed errors — adapter/engine errors should not crash the worker
        Effect.catchAll((e) =>
          Effect.gen(function* () {
            log(`Worker error: ${e instanceof Error ? e.message : String(e)}`)
            setState("idle")
            yield* Effect.sleep(pollIntervalMs)
          }),
        ),
        // Catch defects — unexpected throws should not crash the worker
        Effect.catchAllDefect((defect) =>
          Effect.gen(function* () {
            log(`Worker error: ${defect instanceof Error ? defect.message : String(defect)}`)
            setState("idle")
            yield* Effect.sleep(pollIntervalMs)
          }),
        ),
        // Interruptions propagate through — stopping the loop cleanly
      ),
    )
  }).pipe(
    Effect.interruptible,
    Effect.ensuring(Effect.sync(() => log("Worker stopped"))),
    Effect.annotateLogs({ workerId }),
  )
}

// ---------------------------------------------------------------------------
// Backward-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Start the Effect-based TUI worker and return an imperative stop handle.
 *
 * Internally forks tuiWorkerEffect as a fiber using Effect.runFork.
 * Stop is achieved by interrupting the fiber — the interrupt is delivered
 * at the next Effect operator (sleep, yield*, etc.), cleanly stopping the
 * poll loop.
 *
 * The controller and test suites use this as the primary worker entry point.
 */
export function startTuiWorker(
  callbacks: TuiWorkerCallbacks,
  opts?: TuiWorkerOptions & {
    /**
     * Optional scoped Effect runner that delegates through a managed runtime
     * (e.g. the TUI controller's ManagedRuntime). When provided, all Effect
     * executions inside the worker loop use this runner instead of bare
     * Effect.runPromise, ensuring consistent logging and runtime configuration.
     *
     * Defaults to Effect.runPromise for backward compatibility.
     */
    readonly runEffect?: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  },
): { stop: () => void } {
  // Fork the Effect-based worker immediately using the default runtime.
  // The fiber starts running right away, matching the old fire-and-forget
  // async loop behavior.
  const fiber = Effect.runFork(tuiWorkerEffect(callbacks, opts))

  return {
    stop: () => {
      // Interrupt the fiber — non-blocking, the interrupt is delivered
      // at the next Effect operator (sleep, yield*, etc.).
      Effect.runFork(Fiber.interrupt(fiber))
    },
  }
}
