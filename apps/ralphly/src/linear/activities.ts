/**
 * ABOUTME: Session activity writer for Linear agent sessions.
 * Writes visible session activities back to Linear using the SDK's
 * createAgentActivity mutation. Activities are the mechanism for
 * making ralphly's progress visible in the Linear session UI.
 *
 * Uses a fire-and-forget error strategy: failures log warnings but
 * never propagate, matching the ralphe comment-writing pattern.
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
 * Maps directly to the PRD requirement:
 *   - start: acknowledgement when processing begins
 *   - check_failed: retry/check-failure notification
 *   - success: all checks passed
 *   - error: terminal failure after exhausting retries
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
 * Returns null for events that don't need a session update
 * (e.g. attempt_start — we handle start separately).
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
      return {
        kind: "success",
        body: formatSuccessActivity(event.attempt, event.maxAttempts),
      }
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
 * Write a terminal error activity to a Linear session.
 */
export const writeErrorActivity = (
  sessionId: string,
  error: string,
  attempts: number,
): Effect.Effect<void, never, Linear> =>
  writeSessionActivity(sessionId, formatErrorActivity(error, attempts))

/**
 * Build an onEvent callback for blueprints that writes lifecycle
 * activities to the given Linear session. Suitable for passing
 * directly as RunnerOptions.onEvent.
 */
export const makeSessionEventHandler = (
  sessionId: string,
): ((event: LoopEvent) => Effect.Effect<void, never, Linear>) =>
  (event: LoopEvent) => {
    const mapped = mapLoopEventToActivity(event)
    if (!mapped) return Effect.void
    return writeSessionActivity(sessionId, mapped.body)
  }
