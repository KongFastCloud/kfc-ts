/**
 * ABOUTME: Issue runner that composes blueprints primitives for a single
 * Linear issue/session. Owns the per-issue execution workflow assembly
 * and writes explicit session activities at each lifecycle point.
 *
 * ## Workflow Composition (owned by this module)
 *
 * The runner assembles the execution workflow from blueprints primitives:
 *   loop(agent → checks → report → ciGitStep) → postLoopGitOps
 *
 * This composition is local and explicit — there is no shared runner
 * abstraction mediating between ralphly and the primitives.
 *
 * ## Session Write Ownership
 *
 * The runner is the single owner of all session-write decisions:
 *
 *   start        → written on entry, before execution
 *   check_failed → written via onEvent callback during the retry loop
 *   success      → written on exit, after execution completes successfully
 *   error        → written on exit, after execution exhausts all retries
 *
 * Terminal writes (success + error) happen in the runner's post-execution logic,
 * not in the onEvent callback. This keeps all lifecycle boundaries explicit
 * and avoids dual-writing from both the callback and the runner.
 *
 * The error activity doubles as the durable held marker — see activities.ts.
 *
 * Session activities are fire-and-forget — write failures never block execution.
 */

import { Effect, Layer, pipe } from "effect"
import type { LinearClient } from "@linear/sdk"
import {
  Engine,
  type AgentResult,
  type LoopEvent,
  loop,
  agent,
  cmd,
  report,
  FatalError,
  buildCiGitStep,
  executePostLoopGitOps,
  defaultGitOps,
  type GitMode,
} from "@workspace/blueprints"
import { Linear } from "./linear/client.js"
import { buildPromptFromIssue } from "./linear/loader.js"
import {
  mapLoopEventToActivity,
  formatStartActivity,
  formatSuccessActivity,
  formatErrorActivity,
} from "./linear/activities.js"
import { buildFailureSummary } from "./error-hold.js"
import type { CandidateWork } from "./linear/types.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Execution configuration for a single issue run.
 * Ralphly owns this type — it is not imported from the blueprints package.
 * The shape matches the primitives it configures: loop maxAttempts, cmd checks,
 * git mode, and report mode.
 */
export interface IssueRunConfig {
  readonly maxAttempts: number
  readonly checks: string[]
  readonly gitMode: GitMode
  readonly report: "browser" | "basic" | "none"
}

/** Result of running a single issue through the execution workflow. */
export interface IssueRunResult {
  /** Whether blueprints completed successfully. */
  readonly success: boolean
  /** The issue identifier (e.g. "ENG-123"). */
  readonly issueIdentifier: string
  /** The issue ID (Linear internal ID). */
  readonly issueId: string
  /** The session ID used for this run. */
  readonly sessionId: string
  /** Number of attempts made. */
  readonly attempts: number
  /** Resume token from the last agent execution. */
  readonly resumeToken?: string | undefined
  /** Error message if the run failed. */
  readonly error?: string | undefined
  /**
   * Short failure summary for use as retry feedback.
   * Only populated when `success` is false.
   */
  readonly failureSummary?: string | undefined
}

/** Options for running a single issue. */
export interface RunIssueOptions {
  /** The candidate work item (session + issue). */
  readonly work: CandidateWork
  /** Explicit execution workspace path passed through to blueprints. */
  readonly workspace: string
  /** Execution configuration for the issue run. */
  readonly config: IssueRunConfig
  /** The Engine layer for agent execution. */
  readonly engineLayer: Layer.Layer<Engine>
  /**
   * Optional retry feedback from a previous failed attempt.
   * Appended to the task prompt when rebuilding context for retries.
   */
  readonly retryFeedback?: string | undefined
}

// ---------------------------------------------------------------------------
// Task input construction
// ---------------------------------------------------------------------------

/**
 * Build the task input string for blueprints from current Linear state.
 * Stays close to ralphe semantics: refresh issue context, then append
 * retry feedback when retrying.
 */
export const buildTaskInput = (
  work: CandidateWork,
  retryFeedback?: string,
): string => {
  const prompt = buildPromptFromIssue(work.issue)

  if (retryFeedback) {
    return `${prompt}\n\n## Previous Attempt Feedback\n${retryFeedback}`
  }

  return prompt
}

// ---------------------------------------------------------------------------
// Fire-and-forget activity writer (uses raw client, no Effect service)
// ---------------------------------------------------------------------------

/**
 * Write an agent activity to a Linear session using the SDK client directly.
 * Fire-and-forget: errors are logged but never propagated.
 *
 * This is used inside blueprints callbacks where the Effect context
 * (Linear service) is not available. The client is captured in a closure
 * before blueprints is invoked.
 */
const writeActivity = (
  client: LinearClient,
  sessionId: string,
  body: string,
): Effect.Effect<void, never> =>
  Effect.tryPromise({
    try: () =>
      client.createAgentActivity({
        agentSessionId: sessionId,
        content: { type: "thought", body },
      }),
    catch: (err) => err,
  }).pipe(
    Effect.tap(() =>
      Effect.logDebug(`Wrote session activity to ${sessionId}: ${body.slice(0, 80)}`),
    ),
    Effect.catchAll((err) =>
      Effect.logWarning(
        `Failed to write session activity to ${sessionId}: ${err}`,
      ),
    ),
  )

// ---------------------------------------------------------------------------
// Issue runner
// ---------------------------------------------------------------------------

/**
 * Run a single Linear issue through a locally-assembled execution workflow
 * with explicit session activity writes at each lifecycle point.
 *
 * ## Workflow composition (owned by this function)
 *
 * The execution pipeline is assembled from blueprints primitives:
 *   loop(agent → checks → report → ciGitStep) → postLoopGitOps
 *
 * This is a flat, visible composition — not a delegation to a shared runner.
 * The runner decides which steps to include based on its own IssueRunConfig.
 *
 * ## Lifecycle
 *
 * 1. Capture the Linear client from the Effect context
 * 2. Build task input from issue data (+ optional retry feedback)
 * 3. Write **start** activity to the Linear session
 * 4. Execute workflow — onEvent writes **check_failed** activities
 * 5a. On success: write **success** activity
 * 5b. On failure: write **error** activity (the durable held marker)
 * 6. Return structured result
 *
 * Every processing run produces exactly: start → [check_failed…] → success | error.
 *
 * The runner is the single owner of terminal writes (success + error).
 * The onEvent callback only handles intermediate check_failed events.
 * This keeps the session-write contract explicit and symmetric.
 *
 * The error activity written on failure (step 5b) is the durable hold mechanism:
 * a fresh `ralphly run` can load session activities and detect the error activity
 * to classify the issue as error-held without any in-memory state.
 *
 * Session activities are fire-and-forget — write failures never block execution.
 */
export const runIssue = (
  opts: RunIssueOptions,
): Effect.Effect<IssueRunResult, never, Linear> =>
  Effect.gen(function* () {
    const { work, workspace, config, engineLayer, retryFeedback } = opts
    const { session, issue } = work

    // Capture the Linear client so callbacks can use it without Effect context
    const client = yield* Linear

    yield* Effect.logInfo(
      `Running issue ${issue.identifier}: ${issue.title} (session: ${session.id})`,
    )

    // 1. Build task input
    const task = buildTaskInput(work, retryFeedback)
    yield* Effect.logDebug(`Task input (${task.length} chars)`)

    // 2. Write start activity
    yield* writeActivity(client, session.id, formatStartActivity(issue.identifier))

    // 3. Assemble and execute workflow from blueprints primitives
    //    Composition: loop(agent → checks → report → ciGitStep) → postLoopGitOps
    //    The onEvent callback only handles intermediate check_failed events.
    //    Terminal writes (success/error) are handled below in step 4.

    // Mutable state captured by the loop body closure
    let lastResumeToken: string | undefined
    let attemptCount = 0
    const ops = defaultGitOps

    const retryLoop = loop(
      (feedback, attempt, _maxAttempts) => {
        attemptCount = attempt

        // Agent step: execute with optional feedback from previous failure
        let pipeline: Effect.Effect<unknown, any, Engine> = agent(task, workspace, { feedback }).pipe(
          Effect.tap((result: AgentResult) => {
            lastResumeToken = result.resumeToken
            return Effect.void
          }),
        )

        // Check steps: run each shell command in sequence
        for (const check of config.checks) {
          pipeline = pipe(pipeline, Effect.andThen(cmd(check, workspace)))
        }

        // Report step: verification agent (when configured)
        if (config.report !== "none") {
          pipeline = pipe(pipeline, Effect.andThen(report(task, workspace, config.report)))
        }

        // In-loop CI git step (only for CI mode — commit, push, wait for CI)
        if (config.gitMode === "commit_and_push_and_wait_ci") {
          pipeline = pipe(pipeline, Effect.andThen(buildCiGitStep(ops, workspace)))
        }

        return pipeline
      },
      {
        maxAttempts: config.maxAttempts,
        onEvent: (event: LoopEvent): Effect.Effect<void, never> => {
          const mapped = mapLoopEventToActivity(event)
          if (!mapped) return Effect.void
          return writeActivity(client, session.id, mapped.body)
        },
      },
    )

    // Full workflow: retry loop → post-loop git operations → result
    const result = yield* Effect.gen(function* () {
      yield* Effect.provide(retryLoop, engineLayer)
      yield* Effect.provide(executePostLoopGitOps(config.gitMode, ops, workspace), engineLayer)

      return {
        success: true as const,
        resumeToken: lastResumeToken,
        attempts: attemptCount,
        error: undefined as string | undefined,
      }
    }).pipe(
      Effect.annotateLogs({ gitMode: config.gitMode }),
      Effect.catchTag("FatalError", (err) =>
        Effect.succeed({
          success: false as const,
          resumeToken: lastResumeToken,
          error: err.message as string | undefined,
          attempts: attemptCount,
        }),
      ),
    )

    // 4. Write terminal activity — success or error (never both)
    if (result.success) {
      yield* Effect.logInfo(
        `Issue ${issue.identifier} completed successfully in ${result.attempts} attempt(s)`,
      )
      yield* writeActivity(
        client,
        session.id,
        formatSuccessActivity(result.attempts, config.maxAttempts),
      )
    } else {
      yield* Effect.logWarning(
        `Issue ${issue.identifier} failed after ${result.attempts} attempt(s): ${result.error}`,
      )
      yield* writeActivity(
        client,
        session.id,
        formatErrorActivity(result.error ?? "Unknown error", result.attempts),
      )
    }

    return {
      success: result.success,
      issueIdentifier: issue.identifier,
      issueId: issue.id,
      sessionId: session.id,
      attempts: result.attempts,
      resumeToken: result.resumeToken,
      error: result.error,
      failureSummary: result.success
        ? undefined
        : buildFailureSummary(result.error, result.attempts),
    } satisfies IssueRunResult
  })
