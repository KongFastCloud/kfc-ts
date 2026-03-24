/**
 * ABOUTME: Transitional shared runner — will be removed once apps own their workflows.
 *
 * This module provides the legacy `run()` orchestrator that composes
 * agent → checks → report → git into a retry loop. It exists for backward
 * compatibility while ralphly migrates to primitives-based composition.
 *
 * New code should NOT depend on `run()`. Instead, compose workflows from
 * the exported primitives: loop, agent, cmd, report, git steps, and error types.
 *
 * @deprecated Use primitives-based workflow assembly instead of the shared runner.
 * See the package README for composition examples.
 */

import { Effect, Layer, pipe } from "effect"
import type { LoopEvent } from "./loop.js"
import { Engine, type AgentResult } from "./engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
// Re-export git-steps types and functions for backward compatibility.
// These are the canonical exports — this module just re-exports them.
export type { GitMode, GitOps } from "./git-steps.js"
export { buildCiGitStep, executePostLoopGitOps } from "./git-steps.js"

import { type GitOps, defaultGitOps, buildCiGitStep, executePostLoopGitOps } from "./git-steps.js"

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Run configuration for the execution runner.
 * Callers prepare this from their own config format.
 *
 * @deprecated Prefer assembling workflows from primitives directly.
 */
export interface RunConfig {
  readonly maxAttempts: number
  readonly checks: string[]
  readonly gitMode: "none" | "commit" | "commit_and_push" | "commit_and_push_and_wait_ci"
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
// Runner options
// ---------------------------------------------------------------------------

/**
 * @deprecated Prefer assembling workflows from primitives directly.
 */
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
// Main runner (transitional — apps should compose from primitives)
// ---------------------------------------------------------------------------

/**
 * Execute a task through the full blueprints pipeline:
 * agent → checks → report → loop with retries → git mode flow.
 *
 * **Transitional.** This shared runner exists for backward compatibility.
 * The intended steady state is for apps to compose their own workflows
 * from the exported primitives (loop, agent, cmd, report, git steps).
 * See the package README for composition examples.
 *
 * The runner never fails — errors are captured in RunResult.
 *
 * @deprecated Use primitives-based workflow assembly instead.
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
