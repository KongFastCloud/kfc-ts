/**
 * ABOUTME: Session loading from Linear for ralphly.
 * Queries agent sessions and extracts prompt activities from session history.
 * Sessions are the interaction boundary — each delegation creates a session,
 * and follow-up prompts arrive on the same session.
 */

import { Effect } from "effect"
import type { AgentSession } from "@linear/sdk"
import { Linear } from "./client.js"
import { FatalError } from "../errors.js"
import type {
  LinearSessionData,
  AgentSessionStatusValue,
  SessionPrompt,
} from "./types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Linear SDK AgentSession to our plain data type.
 * The SDK uses lazy getters for relations — we extract the IDs eagerly.
 */
const toSessionData = (s: AgentSession): LinearSessionData => ({
  id: s.id,
  status: s.status as AgentSessionStatusValue,
  appUserId: s.appUserId ?? null,
  issueId: s.issueId ?? null,
  creatorId: s.creatorId ?? null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  startedAt: s.startedAt ?? null,
  endedAt: s.endedAt ?? null,
  summary: s.summary ?? null,
})

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a single session by ID directly from Linear.
 */
export const loadSession = (
  sessionId: string,
): Effect.Effect<LinearSessionData | null, FatalError, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear
    const session = yield* Effect.tryPromise({
      try: () => client.agentSession(sessionId),
      catch: (err) =>
        new FatalError({
          command: "loadSession",
          message: `Failed to load session ${sessionId}: ${err}`,
        }),
    })
    if (!session) return null
    return toSessionData(session)
  })

/**
 * Load all agent sessions visible to the authenticated API key.
 * Paginates through all results automatically.
 *
 * When `agentId` is provided, filters to sessions belonging to that agent.
 */
export const loadSessions = (opts?: {
  agentId?: string
}): Effect.Effect<LinearSessionData[], FatalError, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear
    const allSessions: LinearSessionData[] = []

    let hasMore = true
    let cursor: string | undefined

    while (hasMore) {
      const connection = yield* Effect.tryPromise({
        try: () =>
          client.agentSessions({
            first: 50,
            ...(cursor ? { after: cursor } : {}),
          }),
        catch: (err) =>
          new FatalError({
            command: "loadSessions",
            message: `Failed to load agent sessions: ${err}`,
          }),
      })

      for (const session of connection.nodes) {
        const data = toSessionData(session)
        // Client-side filter: only include sessions for the configured agent
        if (opts?.agentId && data.appUserId !== opts.agentId) continue
        allSessions.push(data)
      }

      hasMore = connection.pageInfo.hasNextPage
      cursor = connection.pageInfo.endCursor ?? undefined
    }

    return allSessions
  })

/**
 * Load prompt activities from a session's activity history.
 * Returns activities in chronological order (oldest first).
 *
 * This captures all activity types — the caller decides which types
 * (prompt, response, thought, etc.) are relevant for context building.
 */
export const loadSessionActivities = (
  sessionId: string,
): Effect.Effect<SessionPrompt[], FatalError, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear

    // Load the session first, then its activities
    const session = yield* Effect.tryPromise({
      try: () => client.agentSession(sessionId),
      catch: (err) =>
        new FatalError({
          command: "loadSessionActivities",
          message: `Failed to load session ${sessionId}: ${err}`,
        }),
    })

    if (!session) return []

    const activities = yield* Effect.tryPromise({
      try: () => session.activities({ first: 100 }),
      catch: (err) =>
        new FatalError({
          command: "loadSessionActivities",
          message: `Failed to load activities for session ${sessionId}: ${err}`,
        }),
    })

    const prompts: SessionPrompt[] = activities.nodes.map((a) => ({
      id: a.id,
      type: a.content?.__typename?.replace("AgentActivity", "").replace("Content", "").toLowerCase() ?? "unknown",
      content: (a.content ?? {}) as unknown as Record<string, unknown>,
      createdAt: a.createdAt,
    }))

    // Sort chronologically (oldest first)
    prompts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return prompts
  })

/**
 * Find active (non-terminal) sessions for a given issue.
 * Terminal statuses are: complete, error, stale.
 */
export const findActiveSessionsForIssue = (
  issueId: string,
  sessions: readonly LinearSessionData[],
): LinearSessionData[] =>
  sessions
    .filter(
      (s) =>
        s.issueId === issueId &&
        s.status !== "complete" &&
        s.status !== "error" &&
        s.status !== "stale",
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // newest first
