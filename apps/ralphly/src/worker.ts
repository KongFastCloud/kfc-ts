/**
 * ABOUTME: Worker loop that processes multiple issues from the backlog,
 * deriving all queue truth from Linear-backed state on each iteration.
 *
 * Backlog selection is a pure derivation over loaded Linear issue/session
 * state plus the formal readiness rules. The worker keeps only a transient
 * in-flight set (issue IDs processed in this run) to avoid double-processing
 * within a single manual invocation — it is NOT an authoritative backlog model.
 *
 * Error-held state is dual-sourced from Linear:
 * - Session status "error" (when Linear sets it)
 * - Activity-derived: unresolved error activity in session history (durable)
 *
 * The activity-based detection is the durable mechanism that survives across
 * fresh CLI invocations. On each iteration, the worker loads session activities
 * for candidates and builds an error-held set for classification.
 *
 * When a session has an unresolved error and a prompted follow-up arrives
 * after the last error activity, the worker retries with failure feedback
 * derived from session activities.
 *
 * The worker loop runs until no actionable work remains, then exits.
 */

import { Effect, Layer } from "effect"
import { Engine } from "@workspace/blueprints"
import { Linear } from "./linear/client.js"
import { loadCandidateWork } from "./linear/loader.js"
import { loadSessionActivities } from "./linear/sessions.js"
import { selectNext, formatBacklogSummary, type BacklogSelection } from "./backlog.js"
import { buildClassificationContext } from "./readiness.js"
import { runIssue, type IssueRunResult, type IssueRunConfig } from "./runner.js"
import type { CandidateWork, SessionPrompt } from "./linear/types.js"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for running the worker loop. */
export interface WorkerOptions {
  /** The Linear agent ID to load work for. */
  readonly agentId: string
  /** Explicit execution workspace path passed through to blueprints. */
  readonly workspace: string
  /** Execution configuration for issue runs. */
  readonly config: IssueRunConfig
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

/**
 * Why the worker loop exited. An operator should be able to read this
 * and understand whether the exit was expected.
 */
export type WorkerExitReason =
  /** No candidate work found in Linear at all. */
  | "no_candidates"
  /** Candidates exist but none are actionable (all blocked/held/terminal/ineligible). */
  | "no_actionable"
  /** All actionable work was processed in this run. */
  | "backlog_drained"
  /** Safety bound reached — too many iterations. */
  | "iteration_limit"

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
  /** Why the worker loop stopped. */
  readonly exitReason: WorkerExitReason
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
// Error activity detection — derived from Linear session activities
// ---------------------------------------------------------------------------

/**
 * Extract the body text from a session activity's content payload.
 */
export const getActivityBody = (activity: SessionPrompt): string | undefined => {
  if (typeof activity.content !== "object" || activity.content === null) return undefined
  const body = (activity.content as Record<string, unknown>).body
  return typeof body === "string" ? body : undefined
}

/**
 * Check if a session activity is an error activity written by the worker.
 * Error activities are "thought" type with body matching the format from
 * formatErrorActivity() in activities.ts: "Failed after N attempt(s): ...".
 */
export const isErrorActivity = (activity: SessionPrompt): boolean => {
  if (activity.type !== "thought") return false
  const body = getActivityBody(activity)
  return typeof body === "string" && body.startsWith("Failed after")
}

/**
 * Find the timestamp of the last error activity in a session's history.
 * Returns null if no error activities are found.
 *
 * This derives the failure timestamp from Linear session activities rather
 * than from an in-memory hold record, keeping queue truth in Linear.
 */
export const findLastErrorTimestamp = (
  activities: readonly SessionPrompt[],
): Date | null => {
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i]!
    if (isErrorActivity(a)) {
      return a.createdAt
    }
  }
  return null
}

/**
 * Extract the error summary text from the last error activity.
 * Returns null if no error activities are found.
 *
 * Used to build retry feedback when a prompted follow-up triggers a retry.
 */
export const findLastErrorSummary = (
  activities: readonly SessionPrompt[],
): string | null => {
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i]!
    if (isErrorActivity(a)) {
      return getActivityBody(a) ?? null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

/**
 * Run a single worker iteration: load fresh state from Linear, check for
 * retryable error-held issues, classify remaining work, and process the
 * next actionable issue.
 *
 * All backlog truth (error-held state, readiness classification, selection
 * order) is derived from Linear-backed state. The `inFlight` set is
 * transient process state that prevents double-processing within a single
 * worker run — it is NOT an authoritative backlog model.
 *
 * Returns null run result when no actionable work is available.
 */
export const runWorkerIteration = (
  opts: WorkerOptions,
  inFlight: Set<string>,
): Effect.Effect<WorkerIterationResult, FatalError, Linear> =>
  Effect.gen(function* () {
    // 1. Load fresh candidate work from Linear
    const allCandidates = yield* loadCandidateWork({ agentId: opts.agentId })

    if (allCandidates.length === 0) {
      yield* Effect.logInfo("No candidate work found")
      return { runResult: null, wasRetry: false, retryFeedback: undefined }
    }

    // 2. Check for retryable error-held issues (derived from Linear session state)
    const retryResult = yield* checkForRetries(allCandidates)
    if (retryResult) {
      const { work, feedback } = retryResult
      yield* Effect.logInfo(
        `Retrying error-held issue ${work.issue.identifier} with failure feedback`,
      )

      const result = yield* runIssue({
        work,
        workspace: opts.workspace,
        config: opts.config,
        engineLayer: opts.engineLayer,
        retryFeedback: feedback,
      })

      // Mark as processed (transient in-flight state)
      inFlight.add(work.issue.id)

      return { runResult: result, wasRetry: true, retryFeedback: feedback }
    }

    // 3. Exclude already-processed issues (transient in-flight state)
    const candidates = allCandidates.filter((c) => !inFlight.has(c.issue.id))

    if (candidates.length === 0) {
      yield* Effect.logInfo("No unprocessed candidates remain")
      return { runResult: null, wasRetry: false, retryFeedback: undefined }
    }

    // 4. Build error-held set from session activities (durable Linear state)
    const errorHeldIds = yield* buildErrorHeldIds(candidates)

    // 5. Classify and select — purely from Linear-backed state
    const ctx = buildClassificationContext(candidates, undefined, errorHeldIds)
    const selection = selectNext(candidates, ctx)

    yield* Effect.logInfo(formatBacklogSummary(selection))

    if (!selection.next) {
      yield* Effect.logInfo("No actionable work after classification")
      return { runResult: null, wasRetry: false, retryFeedback: undefined }
    }

    // 6. Run the next actionable issue
    const work = selection.next
    yield* Effect.logInfo(
      `Processing ${work.issue.identifier}: ${work.issue.title}`,
    )

    const result = yield* runIssue({
      work,
      workspace: opts.workspace,
      config: opts.config,
      engineLayer: opts.engineLayer,
    })

    // 7. Mark as processed (transient in-flight state)
    inFlight.add(work.issue.id)

    if (!result.success) {
      yield* Effect.logWarning(
        `Issue ${work.issue.identifier} failed: ${result.failureSummary}`,
      )
    }

    return { runResult: result, wasRetry: false, retryFeedback: undefined }
  })

/**
 * Run the full worker loop until no actionable work remains.
 *
 * Processes issues one at a time, continuing after failures. Each
 * iteration loads fresh state from Linear — backlog selection is a pure
 * derivation over Linear-backed issue/session state, not a private queue.
 *
 * A transient in-flight set tracks which issues have been processed in
 * this run to prevent double-processing. This is NOT an authoritative
 * backlog model — it is discarded when the worker exits.
 */
export const runWorkerLoop = (
  opts: WorkerOptions,
): Effect.Effect<WorkerRunSummary, FatalError, Linear> =>
  Effect.gen(function* () {
    // Transient in-flight state: issue IDs processed in this run.
    // Prevents double-processing within a single worker invocation.
    // Discarded on exit — not an authoritative backlog model.
    const inFlight = new Set<string>()
    const iterations: WorkerIterationResult[] = []
    let processed = 0
    let succeeded = 0
    let errorHeld = 0
    let retried = 0
    let exitReason: WorkerExitReason = "backlog_drained"

    // Loop until no work is available
    // Safety bound: prevent infinite loops — stop after a generous limit
    const maxIterations = 100

    for (let i = 0; i < maxIterations; i++) {
      const iterResult = yield* runWorkerIteration(opts, inFlight)
      iterations.push(iterResult)

      if (!iterResult.runResult) {
        // No work available — determine why
        if (processed === 0 && i === 0) {
          // First iteration returned nothing — either no candidates or nothing actionable
          // The iteration logs the specific reason, so we check the most common case
          exitReason = "no_candidates"
        } else if (processed === 0) {
          exitReason = "no_actionable"
        } else {
          exitReason = "backlog_drained"
        }

        yield* Effect.logInfo(
          `Worker loop complete (${exitReason}). Processed: ${processed}, Succeeded: ${succeeded}, Error-held: ${errorHeld}, Retried: ${retried}`,
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

      // Safety check: if we've hit the iteration limit
      if (i === maxIterations - 1) {
        exitReason = "iteration_limit"
        yield* Effect.logWarning(
          `Worker loop hit iteration limit (${maxIterations}). Stopping.`,
        )
      }
    }

    return {
      processed,
      succeeded,
      errorHeld,
      retried,
      exitReason,
      iterations,
    } satisfies WorkerRunSummary
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a set of issue IDs that are error-held based on session activities.
 *
 * For each candidate, loads session activities from Linear and checks whether
 * the session has an unresolved error activity (an error with no subsequent
 * prompted follow-up). This is the durable hold mechanism — it works even
 * when Linear has not set the session status to "error".
 *
 * Issues that already have session status "error" are included unconditionally
 * (no need to re-scan activities for those).
 *
 * Returns a Set of issue IDs that should be classified as error-held.
 */
export const buildErrorHeldIds = (
  candidates: readonly CandidateWork[],
): Effect.Effect<Set<string>, FatalError, Linear> =>
  Effect.gen(function* () {
    const held = new Set<string>()

    for (const work of candidates) {
      // Session status "error" is always error-held (no activity check needed)
      if (work.session.status === "error") {
        held.add(work.issue.id)
        continue
      }

      // For non-error sessions, check activities for an unresolved error marker.
      // This catches the case where the worker wrote an error activity but
      // Linear hasn't (or can't) transition the session status to "error".
      const activities = yield* loadSessionActivities(work.session.id)
      const errorTimestamp = findLastErrorTimestamp(activities)
      if (!errorTimestamp) continue

      // Error found — check if there's a follow-up that clears it
      const followUp = findPromptedFollowUp(activities, errorTimestamp)
      if (!followUp) {
        // Unresolved error → error-held
        held.add(work.issue.id)
      }
      // If there IS a follow-up, the error is cleared → not held
      // (checkForRetries will pick this up as a retry candidate)
    }

    return held
  })

/**
 * Check error-held issues for prompted follow-ups that would trigger a retry.
 * Derives error state and failure context entirely from Linear session state
 * and activities — no private hold queue.
 *
 * Returns the first retryable work item and its combined feedback, or null.
 */
const checkForRetries = (
  candidates: readonly CandidateWork[],
): Effect.Effect<
  { work: CandidateWork; feedback: string } | null,
  FatalError,
  Linear
> =>
  Effect.gen(function* () {
    for (const work of candidates) {
      // Only check error-status sessions (derived from Linear state)
      if (work.session.status !== "error") continue

      // Load session activities to find the error and any follow-up
      const activities = yield* loadSessionActivities(work.session.id)
      const errorTimestamp = findLastErrorTimestamp(activities)
      if (!errorTimestamp) continue

      // Check for prompted follow-up after the error
      const followUp = findPromptedFollowUp(activities, errorTimestamp)
      if (!followUp) continue

      // Build combined feedback from error summary and follow-up
      const errorSummary =
        findLastErrorSummary(activities) ?? "Previous attempt failed"
      const feedback = [
        errorSummary,
        `\nUser follow-up: ${followUp}`,
      ].join("\n")

      return { work, feedback }
    }

    return null
  })
