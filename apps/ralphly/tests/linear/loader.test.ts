/**
 * ABOUTME: Tests for the high-level work loader that assembles candidate work
 * from Linear sessions and issues. Uses mock data at the module boundary
 * to verify assembly logic without hitting the Linear API.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Linear } from "../../src/linear/client.js"
import { loadCandidateWork, buildPromptFromIssue } from "../../src/linear/loader.js"
import type { LinearIssueData, LinearSessionData } from "../../src/linear/types.js"

// ---------------------------------------------------------------------------
// Mock Linear client
// ---------------------------------------------------------------------------

/**
 * Build a mock Linear client layer that returns preconfigured sessions and issues.
 * This avoids hitting the real Linear API while testing assembly logic.
 */
const makeMockLinearLayer = (opts: {
  sessions: MockSession[]
  issues: MockIssue[]
}): Layer.Layer<Linear> => {
  const mockClient = {
    agentSessions: async (_vars?: unknown) => ({
      nodes: opts.sessions.map((s) => ({
        id: s.id,
        status: s.status,
        appUserId: s.appUserId,
        issueId: s.issueId,
        creatorId: s.creatorId ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt ?? s.createdAt,
        startedAt: s.startedAt ?? null,
        endedAt: s.endedAt ?? null,
        summary: s.summary ?? null,
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
    issues: async (vars?: { filter?: { delegate?: { id: { eq: string } } } }) => {
      const agentId = vars?.filter?.delegate?.id?.eq
      const filtered = agentId
        ? opts.issues.filter((i) => i.delegateId === agentId)
        : opts.issues
      return {
        nodes: filtered.map((i) => ({
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          description: i.description ?? null,
          url: i.url ?? `https://linear.app/issue/${i.identifier}`,
          priority: i.priority ?? 3,
          priorityLabel: i.priorityLabel ?? "Normal",
          estimate: i.estimate ?? null,
          branchName: i.branchName ?? `${i.identifier.toLowerCase()}-branch`,
          parentId: i.parentId ?? null,
          delegateId: i.delegateId ?? null,
          assigneeId: i.assigneeId ?? null,
          createdAt: i.createdAt ?? new Date("2025-01-01"),
          updatedAt: i.updatedAt ?? new Date("2025-01-01"),
          completedAt: i.completedAt ?? null,
          canceledAt: i.canceledAt ?? null,
          // Mock these lazy methods
          state: Promise.resolve(i.state ?? { id: "state-1", name: "In Progress", type: "started" }),
          children: async () => ({ nodes: (i.childIds ?? []).map((cid: string) => ({ id: cid })) }),
          relations: async () => ({ nodes: [] }),
          inverseRelations: async () => ({ nodes: [] }),
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      }
    },
    agentSession: async (id: string) => {
      const s = opts.sessions.find((s) => s.id === id)
      if (!s) return null
      return {
        id: s.id,
        status: s.status,
        appUserId: s.appUserId,
        issueId: s.issueId,
        creatorId: s.creatorId ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt ?? s.createdAt,
        startedAt: s.startedAt ?? null,
        endedAt: s.endedAt ?? null,
        summary: s.summary ?? null,
        activities: async () => ({ nodes: [] }),
      }
    },
    issue: async (id: string) => {
      const i = opts.issues.find((i) => i.id === id)
      if (!i) return null
      return {
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: i.description ?? null,
        url: i.url ?? `https://linear.app/issue/${i.identifier}`,
        priority: i.priority ?? 3,
        priorityLabel: i.priorityLabel ?? "Normal",
        estimate: i.estimate ?? null,
        branchName: i.branchName ?? `${i.identifier.toLowerCase()}-branch`,
        parentId: i.parentId ?? null,
        delegateId: i.delegateId ?? null,
        assigneeId: i.assigneeId ?? null,
        createdAt: i.createdAt ?? new Date("2025-01-01"),
        updatedAt: i.updatedAt ?? new Date("2025-01-01"),
        completedAt: i.completedAt ?? null,
        canceledAt: i.canceledAt ?? null,
        state: Promise.resolve(i.state ?? { id: "state-1", name: "In Progress", type: "started" }),
        children: async () => ({ nodes: (i.childIds ?? []).map((cid: string) => ({ id: cid })) }),
        relations: async () => ({ nodes: [] }),
        inverseRelations: async () => ({ nodes: [] }),
      }
    },
  }

  // Cast to LinearClient — we only use the methods we mock
  return Layer.succeed(Linear, mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>)
}

// ---------------------------------------------------------------------------
// Types for mock data (simplified for tests)
// ---------------------------------------------------------------------------

interface MockSession {
  id: string
  status: string
  appUserId: string
  issueId: string
  creatorId?: string
  createdAt: Date
  updatedAt?: Date
  startedAt?: Date | null
  endedAt?: Date | null
  summary?: string | null
}

interface MockIssue {
  id: string
  identifier: string
  title: string
  description?: string | null
  url?: string
  priority?: number
  priorityLabel?: string
  estimate?: number | null
  branchName?: string
  state?: { id: string; name: string; type: string }
  parentId?: string | null
  childIds?: string[]
  delegateId?: string | null
  assigneeId?: string | null
  createdAt?: Date
  updatedAt?: Date
  completedAt?: Date | null
  canceledAt?: Date | null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const AGENT_ID = "agent-001"

const runWithMock = <A>(
  sessions: MockSession[],
  issues: MockIssue[],
  effect: Effect.Effect<A, unknown, Linear>,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeMockLinearLayer({ sessions, issues }))),
  )

describe("loadCandidateWork", () => {
  test("pairs sessions with their issues", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-03-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.issue.identifier).toBe("ENG-1")
    expect(candidates[0]!.session.id).toBe("s1")
  })

  test("deduplicates: one candidate per issue even with multiple sessions", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
        {
          id: "s2",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-06-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(1)
    // Should pick the newest session
    expect(candidates[0]!.session.id).toBe("s2")
  })

  test("filters out sessions belonging to other agents", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: "other-agent",
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
        {
          id: "s2",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-03-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.session.id).toBe("s2")
  })

  test("skips issues without any sessions", async () => {
    const candidates = await runWithMock(
      [],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(0)
  })

  test("includes issue with only terminal sessions (for classification)", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "complete",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    // The issue has no active sessions but has a terminal one — still included
    // so downstream classification can decide what to do
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.session.status).toBe("complete")
  })

  test("returns empty when no delegated issues exist", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
      ],
      [],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(0)
  })

  test("handles multiple issues with their respective sessions", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
        {
          id: "s2",
          status: "pending",
          appUserId: AGENT_ID,
          issueId: "i2",
          createdAt: new Date("2025-02-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix bug A",
          delegateId: AGENT_ID,
        },
        {
          id: "i2",
          identifier: "ENG-2",
          title: "Fix bug B",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    expect(candidates).toHaveLength(2)
    const identifiers = candidates.map((c) => c.issue.identifier).sort()
    expect(identifiers).toEqual(["ENG-1", "ENG-2"])
  })
})

describe("buildPromptFromIssue (integration)", () => {
  test("builds prompt from loaded issue data", async () => {
    const candidates = await runWithMock(
      [
        {
          id: "s1",
          status: "active",
          appUserId: AGENT_ID,
          issueId: "i1",
          createdAt: new Date("2025-01-01"),
        },
      ],
      [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix login bug",
          description: "Users cannot log in after password reset.",
          delegateId: AGENT_ID,
        },
      ],
      loadCandidateWork({ agentId: AGENT_ID }),
    )

    const prompt = buildPromptFromIssue(candidates[0]!.issue)
    expect(prompt).toContain("Fix login bug")
    expect(prompt).toContain("Users cannot log in after password reset.")
  })
})
