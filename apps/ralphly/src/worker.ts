/**
 * ABOUTME: Worker loop that processes multiple issues from the backlog,
 * handling error-hold and same-session retry behavior.
 *
 * When blueprints exhausts retries for an issue, the worker records it
 * as error-held and continues to the next actionable issue instead of
 * stopping globally. A prompted follow-up on the same session can clear
 * the hold and retry the issue with failure feedback.
 *
 * The worker loop runs until no actionable work remains, then exits.
 */

import { Effect, Layer } from "effect"
import type { RunConfig } from "@workspace/blueprints"
import { Engine } from "@workspace/blueprints"
import { Linear } from "./linear/client.js"
import { loadCandidateWork } from "./linear/loader.js"
import { loadSessionActivities } from "./linear/sessions.js"
import { selectNext, formatBacklogSummary, type BacklogSelection } from "./backlog.js"
import { buildClassificationContext, type ClassificationContext } from "./readiness.js"
import { runIssue, type IssueRunResult } from "./runner.js"
import { ErrorHoldStore, buildFailureSummary, type ErrorHoldRecord } from "./error-hold.js"
import type { CandidateWork, SessionPrompt } from "./linear/types.js"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for running the worker loop. */
export interface WorkerOptions {
  /** The Linear agent ID to load work for. */
  readonly agentId: string
  /** Blueprints run configuration. */
  readonly config: RunConfig
  /** The Engine layer for agent execution. */
  readonly engineLayer: Layer.Layer<Engine>
}

/** Result of a single iteration of the worker loop. */
export interface WorkerIterationResult {
  /** The issue run result, or null if no work was available. */
  readonly runResult: IssueRunResult | null
  /** Whether the issue was a retry of an error-held issue. */
  readonly wasRetry: boolean
  /** The retry feedback used, if this was a retry. */
  readonly retryFeedback: string | undefined
}

/** Summary of the full worker run. */
export interface WorkerRunSummary {
  /** Total issues processed (attempted). */
  readonly processed: number
  /** Issues that succeeded. */
  readonly succeeded: number
  /** Issues that failed and were error-held. */
  readonly errorHeld: number
  /** Issues that were retried after a prompted follow-up. */
  readonly retried: number
  /** All individual iteration results. */
  readonly iterations: readonly WorkerIterationResult[]
}

// ---------------------------------------------------------------------------
// Prompted follow-up detection
// ---------------------------------------------------------------------------

/**
 * Check whether a session has a prompted follow-up activity that arrived
 * after a given timestamp (the failure time). If so, the human has sent
 * a follow-up that can clear the error-hold and trigger a retry.
 *
 * Returns the newest prompt content if found, or null.
 */
export const findPromptedFollowUp = (
  activities: readonly SessionPrompt[],
  afterTimestamp: Date,
): string | null => {
  // Look for prompt-type activities after the failure
  const prompts = activities.filter(
    (a) =>
      a.type === "prompt" &&
      a.createdAt.getTime() > afterTimestamp.getTime(),
  )

  if (prompts.length === 0) return null

  // Return the newest prompt's body content
  const newest = prompts[prompts.length - 1]!
  const body =
    typeof newest.content === "object" && newest.content !== null
      ? (newest.content as Record<string, unknown>).body
      : undefined

  return typeof body === "string" ? body : "(follow-up prompt)"
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

/**
 * Run a single worker iteration: find the next actionable issue and
 * process it. Handles error-hold recording on failure and retry
 * detection for previously error-held issues.
 *
 * Returns null run result when no actionable work is available.
 */
export const runWorkerIteration = (
  opts: WorkerOptions,
  errorHolds: ErrorHoldStore,
): Effect.Effect<WorkerIterationResult, FatalError, Linear> =>
  Effect.gen(function* () {
    // 1. Load fresh candidate work from Linear
    const candidates = yield* loadCandidateWork({ agentId: opts.agentId })

    if (candidates.length === 0) {
      yield* Effect.logInfo("No candidate work found")
      return { runResult: null, wasRetry: false, retryFeedback: undefined }
    }

    // 2. Check for prompted follow-ups on error-held issues first
    const retryResult = yield* checkForRetries(candidates, errorHolds)
    if (retryResult) {
      const { work, feedback } = retryResult
      yield* Effect.logInfo(
        `Retrying error-held issue ${work.issue.identifier} with failure feedback`,
      )

      const result = yield* runIssue({
        work,
        config: opts.config,
        engineLayer: opts.engineLayer,
        retryFeedback: feedback,
      })

      // If the retry also fails, re-record the hold
      if (!result.success) {
        errorHolds.record({
          issueId: work.issue.id,
          sessionId: work.session.id,
          failureSummary: buildFailureSummary(result.error, result.attempts),
          failedAt: new Date(),
        })
      }

      return { runResult: result, wasRetry: true, retryFeedback: feedback }
    }

    // 3. Build classification context with runtime error-holds merged in
    const ctx = buildClassificationContextWithHolds(candidates, errorHolds)
    const selection = selectNext(candidates, ctx)

    yield* Effect.logInfo(formatBacklogSummary(selection))

    if (!selection.next) {
      yield* Effect.logInfo("No actionable work after classification")
      return { runResult: null, wasRetry: false, retryFeedback: undefined }
    }

    // 4. Run the next actionable issue
    const work = selection.next
    yield* Effect.logInfo(
      `Processing ${work.issue.identifier}: ${work.issue.title}`,
    )

    const result = yield* runIssue({
      work,
      config: opts.config,
      engineLayer: opts.engineLayer,
    })

    // 5. On failure, record error-hold instead of stopping
    if (!result.success) {
      const summary = buildFailureSummary(result.error, result.attempts)
      errorHolds.record({
        issueId: work.issue.id,
        sessionId: work.session.id,
        failureSummary: summary,
        failedAt: new Date(),
      })
      yield* Effect.logWarning(
        `Issue ${work.issue.identifier} error-held: ${summary}`,
      )
    }

    return { runResult: result, wasRetry: false, retryFeedback: undefined }
  })

/**
 * Run the full worker loop until no actionable work remains.
 *
 * Processes issues one at a time, recording failures as error-holds
 * and continuing to the next actionable issue. Checks for prompted
 * follow-ups on error-held issues at each iteration.
 */
export const runWorkerLoop = (
  opts: WorkerOptions,
): Effect.Effect<WorkerRunSummary, FatalError, Linear> =>
  Effect.gen(function* () {
    const errorHolds = new ErrorHoldStore()
    const iterations: WorkerIterationResult[] = []
    let processed = 0
    let succeeded = 0
    let errorHeld = 0
    let retried = 0

    // Loop until no work is available
    // Safety bound: prevent infinite loops — stop after a generous limit
    const maxIterations = 100

    for (let i = 0; i < maxIterations; i++) {
      const iterResult = yield* runWorkerIteration(opts, errorHolds)
      iterations.push(iterResult)

      if (!iterResult.runResult) {
        // No work available — exit the loop
        yield* Effect.logInfo(
          `Worker loop complete. Processed: ${processed}, Succeeded: ${succeeded}, Error-held: ${errorHeld}, Retried: ${retried}`,
        )
        break
      }

      processed++
      if (iterResult.wasRetry) retried++

      if (iterResult.runResult.success) {
        succeeded++
      } else {
        errorHeld++
      }
    }

    return {
      processed,
      succeeded,
      errorHeld,
      retried,
      iterations,
    } satisfies WorkerRunSummary
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check error-held issues for prompted follow-ups that would trigger a retry.
 * Returns the first retryable work item and its combined feedback, or null.
 */
const checkForRetries = (
  candidates: readonly CandidateWork[],
  errorHolds: ErrorHoldStore,
): Effect.Effect<
  { work: CandidateWork; feedback: string } | null,
  FatalError,
  Linear
> =>
  Effect.gen(function* () {
    for (const work of candidates) {
      const hold = errorHolds.get(work.issue.id)
      if (!hold) continue

      // Check session activities for a prompted follow-up after the failure
      const activities = yield* loadSessionActivities(work.session.id)
      const followUp = findPromptedFollowUp(activities, hold.failedAt)

      if (followUp) {
        // Clear the hold — we're about to retry
        errorHolds.clear(work.issue.id)

        // Build combined feedback: failure summary + follow-up context
        const feedback = [
          hold.failureSummary,
          `\nUser follow-up: ${followUp}`,
        ].join("\n")

        return { work, feedback }
      }
    }

    return null
  })

/**
 * Build a ClassificationContext that merges Linear session status
 * with runtime error-hold records. This ensures issues held in the
 * current worker run are classified as error-held even if the
 * Linear session status hasn't been updated yet.
 */
const buildClassificationContextWithHolds = (
  candidates: readonly CandidateWork[],
  errorHolds: ErrorHoldStore,
): ClassificationContext => {
  const base = buildClassificationContext(candidates)

  // Merge runtime holds into the error-held set
  const runtimeHeldIds = errorHolds.heldIds()
  if (runtimeHeldIds.size === 0) return base

  const mergedHeldIds = new Set(base.errorHeldIds)
  for (const id of runtimeHeldIds) {
    mergedHeldIds.add(id)
  }

  return {
    issuesById: base.issuesById,
    errorHeldIds: mergedHeldIds,
  }
}
