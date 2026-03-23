/**
 * ABOUTME: High-level work loader that assembles candidate work items
 * from Linear sessions and issues. This is the main entry point for
 * ralphly's "query Linear for actionable work" step.
 *
 * Combines session and issue loading into CandidateWork items that
 * downstream code can classify for readiness and build prompts from.
 */

import { Effect } from "effect"
import { Linear } from "./client.js"
import { loadSession, loadSessions, findActiveSessionsForIssue } from "./sessions.js"
import { loadIssue, loadDelegatedIssues, isTerminal } from "./issues.js"
import { FatalError } from "../errors.js"
import type { CandidateWork, LinearIssueData, LinearSessionData } from "./types.js"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all candidate work for the configured agent.
 *
 * Strategy:
 * 1. Load all issues delegated to the agent (non-terminal).
 * 2. Load all agent sessions.
 * 3. For each delegated issue, find the newest active session.
 * 4. Pair them into CandidateWork items.
 *
 * Issues without an active session are still included (session will be
 * the newest session regardless of status, or null-skipped if none exist).
 *
 * Deduplication: each issue appears at most once. When multiple sessions
 * exist for the same issue, the newest active session wins. This implements
 * the "one active run per issue" invariant from the PRD.
 */
export const loadCandidateWork = (opts: {
  agentId: string
}): Effect.Effect<CandidateWork[], FatalError, Linear> =>
  Effect.gen(function* () {
    // Load issues and sessions in parallel
    const [issues, sessions] = yield* Effect.all(
      [
        loadDelegatedIssues({ agentId: opts.agentId }),
        loadSessions({ agentId: opts.agentId }),
      ] as const,
      { concurrency: 2 },
    )

    yield* Effect.logDebug(
      `Loaded ${issues.length} delegated issues and ${sessions.length} sessions for agent ${opts.agentId}`,
    )

    const candidates: CandidateWork[] = []

    for (const issue of issues) {
      // Skip terminal issues that slipped through the filter
      if (isTerminal(issue)) continue

      // Find the best session for this issue
      const activeSessions = findActiveSessionsForIssue(issue.id, sessions)
      const bestSession = activeSessions[0]

      if (!bestSession) {
        // No active session — check if there's any session at all
        const anySessions = sessions.filter((s) => s.issueId === issue.id)
        const newestSession = anySessions.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )[0]

        if (!newestSession) {
          // Issue is delegated but has no sessions — skip for now.
          // This can happen if the delegation was done outside the agent
          // session flow (e.g. direct assignment).
          yield* Effect.logDebug(
            `Issue ${issue.identifier} has no sessions — skipping`,
          )
          continue
        }

        // There are sessions but none active — include with the newest
        // session so downstream classification can decide what to do
        candidates.push({ session: newestSession, issue })
        continue
      }

      candidates.push({ session: bestSession, issue })
    }

    return candidates
  })

/**
 * Rehydrate a single work item from Linear by session ID.
 * Used when resuming from a known session (e.g. after a "prompted" event).
 *
 * Returns null if the session or its issue cannot be loaded.
 */
export const rehydrateFromSession = (
  sessionId: string,
): Effect.Effect<CandidateWork | null, FatalError, Linear> =>
  Effect.gen(function* () {
    const session = yield* loadSession(sessionId)
    if (!session) {
      yield* Effect.logWarning(`Session ${sessionId} not found`)
      return null
    }

    if (!session.issueId) {
      yield* Effect.logWarning(`Session ${sessionId} has no associated issue`)
      return null
    }

    const issue = yield* loadIssue(session.issueId)
    if (!issue) {
      yield* Effect.logWarning(
        `Issue ${session.issueId} for session ${sessionId} not found`,
      )
      return null
    }

    return { session, issue }
  })

/**
 * Build a task prompt from issue data, matching the ralphe prompt format.
 * Fields are included in order: title, description.
 * The prompt is intentionally kept close to ralphe's buildPromptFromIssue
 * so that blueprints receives similar input regardless of the source tracker.
 */
export const buildPromptFromIssue = (issue: LinearIssueData): string => {
  const sections: string[] = []

  sections.push(issue.title)

  if (issue.description) {
    sections.push(`\n## Description\n${issue.description}`)
  }

  return sections.join("\n")
}
