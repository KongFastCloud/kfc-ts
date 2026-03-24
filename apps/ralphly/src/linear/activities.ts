/**
 * ABOUTME: Session activity writer for Linear agent sessions.
 * Writes visible session activities back to Linear using the SDK's
 * createAgentActivity mutation. Activities are the mechanism for
 * making ralphly's progress visible in the Linear session UI.
 *
 * Uses a fire-and-forget error strategy: failures log warnings but
 * never propagate, matching the ralphe comment-writing pattern.
 *
 * ## Session Write Contract
 *
 * The worker writes one activity per lifecycle transition. Every
 * processing run produces exactly: start → [check_failed…] → success | error.
 *
 *   State         Written by     Activity body
 *   ─────         ──────────     ─────────────
 *   start         runner entry   "Starting work on ENG-123"
 *   check_failed  onEvent cb     "[attempt 1/3] Check failed — retrying\n…"
 *   success       runner exit    "[attempt 2/3] All checks passed ✓"
 *   error         runner exit    "Failed after 3 attempt(s): …"
 *
 * The error activity has dual semantics:
 *   1. It notifies the operator that processing failed terminally.
 *   2. It serves as the **durable held marker** — a future `ralphly run`
 *      loads session activities and detects this activity to classify the
 *      issue as error-held. The hold is only cleared when a prompted
 *      follow-up arrives after the error timestamp.
 *
 * There is no separate "held" activity. The error activity IS the held
 * marker, and its presence (or absence of a subsequent follow-up) drives
 * the error-held classification in readiness.ts.
 */

import { Effect } from "effect"
import { Linear } from "./client.js"
import type { LoopEvent } from "@workspace/blueprints"

// ---------------------------------------------------------------------------
// Activity content types
// ---------------------------------------------------------------------------

/**
 * The content types Linear recognizes for agent activities.
 * We use "thought" for all lifecycle updates since it renders
 * as a visible status in the session UI without implying a
 * direct response to the user.
 */
export type ActivityContentType = "thought"

/** Content payload for a Linear agent activity. */
export interface ActivityContent {
  readonly type: ActivityContentType
  readonly body: string
}

// ---------------------------------------------------------------------------
// Session update types
// ---------------------------------------------------------------------------

/**
 * Lifecycle update types that ralphly writes to Linear sessions.
 *
 * Each type maps to exactly one session-write site in the runner:
 *   - start:        runner writes on entry, before blueprints invocation
 *   - check_failed: onEvent callback writes during blueprints retry loop
 *   - success:      runner writes after blueprints completes successfully
 *   - error:        runner writes after blueprints exhausts all retries
 *
 * The error activity doubles as the durable held marker — see module doc.
 */
export type SessionUpdateKind = "start" | "check_failed" | "success" | "error"

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format the start acknowledgement activity body.
 */
export const formatStartActivity = (
  issueIdentifier: string,
): string =>
  `Starting work on ${issueIdentifier}`

/**
 * Format a check-failed / retry activity body.
 */
export const formatCheckFailedActivity = (
  attempt: number,
  maxAttempts: number,
  feedback: string,
): string =>
  `[attempt ${attempt}/${maxAttempts}] Check failed — retrying\n${feedback}`

/**
 * Format a success activity body.
 */
export const formatSuccessActivity = (
  attempt: number,
  maxAttempts: number,
): string =>
  `[attempt ${attempt}/${maxAttempts}] All checks passed ✓`

/**
 * Format a terminal error activity body.
 */
export const formatErrorActivity = (
  error: string,
  attempts: number,
): string =>
  `Failed after ${attempts} attempt(s): ${error}`

// ---------------------------------------------------------------------------
// Lifecycle event → activity mapping
// ---------------------------------------------------------------------------

/**
 * Map a blueprints LoopEvent to a session activity body.
 *
 * Only maps **intermediate** events that occur within the retry loop:
 *   - check_failed → activity written immediately
 *
 * Terminal events are NOT mapped here — they are written explicitly
 * by the runner at well-defined lifecycle points:
 *   - start       → runner entry (writeStartActivity)
 *   - success     → runner exit  (writeSuccessActivity)
 *   - error       → runner exit  (writeErrorActivity)
 *   - attempt_start → no activity (internal loop bookkeeping)
 *
 * Returns null for events that don't need a session update.
 */
export const mapLoopEventToActivity = (
  event: LoopEvent,
): { kind: SessionUpdateKind; body: string } | null => {
  switch (event.type) {
    case "check_failed":
      return {
        kind: "check_failed",
        body: formatCheckFailedActivity(
          event.attempt,
          event.maxAttempts,
          event.feedback ?? "",
        ),
      }
    case "success":
      // Success is written explicitly by the runner after execution
      // completes — not through the onEvent callback. This keeps all
      // terminal writes (success + error) in one place in the runner.
      return null
    case "attempt_start":
      // Start is handled separately via writeStartActivity
      return null
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Linear API writer
// ---------------------------------------------------------------------------

/**
 * Write an agent activity to a Linear session.
 * Fire-and-forget: errors log a warning but never propagate.
 */
export const writeSessionActivity = (
  sessionId: string,
  body: string,
): Effect.Effect<void, never, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear
    yield* Effect.tryPromise({
      try: () =>
        client.createAgentActivity({
          agentSessionId: sessionId,
          content: {
            type: "thought",
            body,
          },
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
  })

/**
 * Write a start acknowledgement activity to a Linear session.
 */
export const writeStartActivity = (
  sessionId: string,
  issueIdentifier: string,
): Effect.Effect<void, never, Linear> =>
  writeSessionActivity(sessionId, formatStartActivity(issueIdentifier))

/**
 * Write a success activity to a Linear session.
 * Called by the runner after blueprints completes with all checks passing.
 */
export const writeSuccessActivity = (
  sessionId: string,
  attempt: number,
  maxAttempts: number,
): Effect.Effect<void, never, Linear> =>
  writeSessionActivity(sessionId, formatSuccessActivity(attempt, maxAttempts))

/**
 * Write a check-failed / retry activity to a Linear session.
 * Called via the onEvent callback during the blueprints retry loop.
 */
export const writeCheckFailedActivity = (
  sessionId: string,
  attempt: number,
  maxAttempts: number,
  feedback: string,
): Effect.Effect<void, never, Linear> =>
  writeSessionActivity(
    sessionId,
    formatCheckFailedActivity(attempt, maxAttempts, feedback),
  )

/**
 * Write a terminal error activity to a Linear session.
 *
 * This activity has dual semantics:
 * 1. It notifies the operator of the terminal failure.
 * 2. It serves as the durable held marker — a future `ralphly run`
 *    detects this activity via `isErrorActivity()` and classifies the
 *    issue as error-held until a prompted follow-up clears it.
 */
export const writeErrorActivity = (
  sessionId: string,
  error: string,
  attempts: number,
): Effect.Effect<void, never, Linear> =>
  writeSessionActivity(sessionId, formatErrorActivity(error, attempts))

/**
 * Build an onEvent callback for blueprints that writes intermediate
 * lifecycle activities to the given Linear session.
 *
 * Only handles check_failed events (intermediate retry notifications).
 * The start and terminal activities (success, error) are written
 * explicitly by the runner at entry and exit — not through this handler.
 *
 * Suitable for passing directly as a loop onEvent callback.
 */
export const makeSessionEventHandler = (
  sessionId: string,
): ((event: LoopEvent) => Effect.Effect<void, never, Linear>) =>
  (event: LoopEvent) => {
    const mapped = mapLoopEventToActivity(event)
    if (!mapped) return Effect.void
    return writeSessionActivity(sessionId, mapped.body)
  }
