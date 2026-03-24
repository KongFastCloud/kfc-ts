/**
 * ABOUTME: Issue runner that invokes blueprints for a single Linear issue/session.
 * Builds task input from current Linear state, invokes blueprints.run(),
 * and translates lifecycle events into Linear session activities.
 *
 * On terminal failure, writes a durable error activity to the Linear session
 * so that a fresh `ralphly run` can detect the failure from activities alone.
 *
 * This is the integration layer between ralphly's Linear-aware model
 * and the tracker-agnostic blueprints execution runner.
 */

import { Effect, Layer } from "effect"
import type { LinearClient } from "@linear/sdk"
import { run as blueprintsRun, type RunConfig, type RunResult, type LoopEvent } from "@workspace/blueprints"
import { Engine } from "@workspace/blueprints"
import { Linear } from "./linear/client.js"
import { buildPromptFromIssue } from "./linear/loader.js"
import {
  mapLoopEventToActivity,
  formatStartActivity,
  formatErrorActivity,
} from "./linear/activities.js"
import { buildFailureSummary } from "./error-hold.js"
import type { CandidateWork } from "./linear/types.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of running a single issue through blueprints. */
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
  /** Blueprints run configuration. */
  readonly config: RunConfig
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
 * Run a single Linear issue through blueprints with session activity updates.
 *
 * Flow:
 * 1. Capture the Linear client from the Effect context
 * 2. Build task input from issue data (+ optional retry feedback)
 * 3. Write start acknowledgement to the Linear session
 * 4. Invoke blueprints.run() with lifecycle callbacks wired to session updates
 * 5. On failure, write a terminal error activity (the durable hold marker)
 * 6. Return structured result
 *
 * The error activity written on failure (step 5) is the durable hold mechanism:
 * a fresh `ralphly run` can load session activities and detect the error activity
 * to classify the issue as error-held without any in-memory state.
 *
 * Session activities are fire-and-forget — write failures never block execution.
 * The Linear service dependency is required for session writes.
 */
export const runIssue = (
  opts: RunIssueOptions,
): Effect.Effect<IssueRunResult, never, Linear> =>
  Effect.gen(function* () {
    const { work, config, engineLayer, retryFeedback } = opts
    const { session, issue } = work

    // Capture the Linear client so callbacks can use it without Effect context
    const client = yield* Linear

    yield* Effect.logInfo(
      `Running issue ${issue.identifier}: ${issue.title} (session: ${session.id})`,
    )

    // 1. Build task input
    const task = buildTaskInput(work, retryFeedback)
    yield* Effect.logDebug(`Task input (${task.length} chars)`)

    // 2. Write start acknowledgement
    yield* writeActivity(client, session.id, formatStartActivity(issue.identifier))

    // 3. Invoke blueprints with lifecycle callbacks
    //    Callbacks capture the Linear client in a closure so they don't need
    //    the Effect context. blueprints.run() expects Effect.Effect<void, never>.
    const result: RunResult = yield* blueprintsRun({
      task,
      config,
      engineLayer,
      onEvent: (event: LoopEvent): Effect.Effect<void, never> => {
        const mapped = mapLoopEventToActivity(event)
        if (!mapped) return Effect.void
        return writeActivity(client, session.id, mapped.body)
      },
    })

    // 4. Handle terminal failure
    if (!result.success) {
      yield* Effect.logWarning(
        `Issue ${issue.identifier} failed after ${result.attempts} attempt(s): ${result.error}`,
      )
      yield* writeActivity(
        client,
        session.id,
        formatErrorActivity(result.error ?? "Unknown error", result.attempts),
      )
    } else {
      yield* Effect.logInfo(
        `Issue ${issue.identifier} completed successfully in ${result.attempts} attempt(s)`,
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
