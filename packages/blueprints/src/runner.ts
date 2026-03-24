/**
 * ABOUTME: The canonical execution runner for blueprints.
 * Composes agent → checks → report → git into a retry loop with lifecycle events.
 * Callers provide prepared task input, an explicit workspace path, an Engine layer,
 * and run configuration. All steps execute within the provided workspace.
 * The runner is agnostic to Linear, Beads, and tracker-specific concerns — callers
 * handle external integrations via the onEvent callback.
 *
 * Preserves ralphe loop semantics:
 * - Caller context refreshed each attempt (feedback propagation)
 * - Failure feedback appended on retry
 * - Structured run results with resume token
 * - Lifecycle events for observer pattern
 */

import { Effect, Layer, pipe } from "effect"
import type { LoopEvent } from "./loop.js"
import { Engine, type AgentResult } from "./engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { gitCommit, gitPush, gitWaitForCi } from "./git.js"
import type { CheckFailure, FatalError } from "./errors.js"
import type { GitCommitResult, GitPushResult, GitHubCiResult } from "./git.js"

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Canonical git operation mode.
 * - "none": No automatic git operations after task completion
 * - "commit": Stage and commit changes but do not push
 * - "commit_and_push": Stage, commit, and push changes
 * - "commit_and_push_and_wait_ci": Stage, commit, push, and wait for CI
 */
export type GitMode =
  | "none"
  | "commit"
  | "commit_and_push"
  | "commit_and_push_and_wait_ci"

/**
 * Run configuration for the execution runner.
 * Callers prepare this from their own config format.
 */
export interface RunConfig {
  readonly maxAttempts: number
  readonly checks: string[]
  readonly gitMode: GitMode
  readonly report: "browser" | "basic" | "none"
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface RunResult {
  readonly success: boolean
  readonly resumeToken?: string | undefined
  readonly error?: string | undefined
  /** Number of attempts made (1 = first attempt succeeded) */
  readonly attempts: number
}

// ---------------------------------------------------------------------------
// Git operations (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Git operation callbacks for dependency injection.
 * Allows tests to provide fake implementations without module mocking.
 * Each operation receives the explicit workspace path to execute within.
 */
export interface GitOps {
  readonly commit: (workspace: string) => Effect.Effect<GitCommitResult | undefined, FatalError, Engine>
  readonly push: (workspace: string) => Effect.Effect<GitPushResult, FatalError>
  readonly waitCi: (workspace: string) => Effect.Effect<GitHubCiResult, FatalError | CheckFailure>
}

const defaultGitOps: GitOps = {
  commit: gitCommit,
  push: gitPush,
  waitCi: gitWaitForCi,
}

// ---------------------------------------------------------------------------
// Git step helpers
// ---------------------------------------------------------------------------

/**
 * Build the in-loop git step for commit_and_push_and_wait_ci mode.
 * Commits, pushes, and waits for CI. Returns CheckFailure on CI failure
 * so the retry loop can feed structured annotations back to the agent.
 */
export const buildCiGitStep = (
  ops: GitOps,
  workspace: string,
): Effect.Effect<void, FatalError | CheckFailure, Engine> =>
  Effect.gen(function* () {
    const commitResult = yield* ops.commit(workspace)
    if (!commitResult) {
      yield* Effect.logDebug("Push/CI skipped: no commit created.")
      return
    }

    yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
    const pushResult = yield* ops.push(workspace)
    yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
    const ciResult = yield* ops.waitCi(workspace)
    yield* Effect.logInfo(`CI passed: run ${ciResult.runId}`)
  })

/**
 * Execute post-loop git operations based on the git mode.
 * Handles "commit" and "commit_and_push" modes.
 * "none" and "commit_and_push_and_wait_ci" are no-ops here
 * (CI mode runs inside the retry loop via buildCiGitStep).
 */
export const executePostLoopGitOps = (
  gitMode: GitMode,
  ops: GitOps,
  workspace: string,
): Effect.Effect<void, FatalError, Engine> =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Git mode: ${gitMode}`)
    switch (gitMode) {
      case "none":
      case "commit_and_push_and_wait_ci":
        break
      case "commit": {
        const commitResult = yield* ops.commit(workspace)
        if (commitResult) {
          yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        }
        break
      }
      case "commit_and_push": {
        const commitResult = yield* ops.commit(workspace)
        if (!commitResult) {
          yield* Effect.logDebug("Push skipped: no commit created.")
          break
        }

        yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        const pushResult = yield* ops.push(workspace)
        yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
        break
      }
    }
  })

// ---------------------------------------------------------------------------
// Runner options
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  /** The task prompt to execute. */
  readonly task: string
  /**
   * Explicit execution workspace path.
   * All steps (agent, checks, reports, git) execute within this directory.
   * Callers provide the repo root, worktree path, or any target directory —
   * the runner never falls back to process.cwd().
   */
  readonly workspace: string
  /** Run configuration (retries, checks, git mode, report mode). */
  readonly config: RunConfig
  /** The Engine layer to use for agent execution. */
  readonly engineLayer: Layer.Layer<Engine>
  /**
   * Optional lifecycle event callback.
   * Called at each loop event (attempt_start, check_failed, success).
   * Use this to integrate with external systems (e.g. issue trackers).
   */
  readonly onEvent?: (event: LoopEvent) => Effect.Effect<void, never>
  /**
   * Optional callback invoked after each successful agent execution.
   * Receives the agent result (including resume token).
   * Use this to track session IDs, write comments, etc.
   */
  readonly onAgentResult?: (result: AgentResult, attempt: number, maxAttempts: number) => Effect.Effect<void, never>
  /** Override git operations for testing. */
  readonly gitOps?: GitOps
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Execute a task through the full blueprints pipeline:
 * agent → checks → report → loop with retries → git mode flow.
 *
 * This is the canonical execution runner. Callers (ralphly, ralphe, etc.)
 * prepare task input, an explicit workspace path, and configuration, then
 * delegate to this function. All execution steps (agent, checks, reports,
 * git) run within the provided workspace — the runner never falls back to
 * process.cwd().
 *
 * The runner handles retries, feedback propagation, engine/check/report
 * orchestration, lifecycle events, and final result shaping.
 *
 * The runner never fails — errors are captured in RunResult.
 */
export const run = (opts: RunnerOptions): Effect.Effect<RunResult, never> => {
  const { task, workspace, config, engineLayer, onEvent, onAgentResult, gitOps } = opts
  const ops = gitOps ?? defaultGitOps

  // Track state across attempts
  let lastResumeToken: string | undefined
  let attemptCount = 0

  const workflow = loop(
    (feedback, attempt, maxAttempts) => {
      attemptCount = attempt

      let pipeline: Effect.Effect<unknown, any, Engine> = agent(task, workspace, { feedback }).pipe(
        Effect.tap((result: AgentResult) => {
          lastResumeToken = result.resumeToken
          return Effect.void
        }),
        Effect.tap((result: AgentResult) => {
          if (!onAgentResult) return Effect.void
          return onAgentResult(result, attempt, maxAttempts)
        }),
      )

      for (const check of config.checks) {
        pipeline = pipe(pipeline, Effect.andThen(cmd(check, workspace)))
      }

      if (config.report !== "none") {
        pipeline = pipe(pipeline, Effect.andThen(report(task, workspace, config.report)))
      }

      if (config.gitMode === "commit_and_push_and_wait_ci") {
        pipeline = pipe(pipeline, Effect.andThen(buildCiGitStep(ops, workspace)))
      }

      return pipeline
    },
    {
      maxAttempts: config.maxAttempts,
      onEvent,
    },
  )

  const fullWorkflow = Effect.gen(function* () {
    yield* Effect.provide(workflow, engineLayer)
    yield* Effect.provide(executePostLoopGitOps(config.gitMode, ops, workspace), engineLayer)

    return {
      success: true,
      resumeToken: lastResumeToken,
      attempts: attemptCount,
    } satisfies RunResult
  }).pipe(Effect.annotateLogs({ gitMode: config.gitMode }))

  return fullWorkflow.pipe(
    Effect.catchTag("FatalError", (err) =>
      Effect.succeed({
        success: false,
        resumeToken: lastResumeToken,
        error: err.message,
        attempts: attemptCount,
      } satisfies RunResult),
    ),
  )
}
