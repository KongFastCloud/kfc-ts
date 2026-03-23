/**
 * ABOUTME: Tests for Linear domain types and pure helper functions.
 * Validates type contracts, findActiveSessionsForIssue, isTerminal,
 * and buildPromptFromIssue without needing a Linear client.
 */

import { describe, test, expect } from "bun:test"
import { findActiveSessionsForIssue } from "../../src/linear/sessions.js"
import { isTerminal } from "../../src/linear/issues.js"
import { buildPromptFromIssue } from "../../src/linear/loader.js"
import type { LinearIssueData, LinearSessionData } from "../../src/linear/types.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<LinearSessionData> = {}): LinearSessionData => ({
  id: "session-1",
  status: "active",
  appUserId: "agent-1",
  issueId: "issue-1",
  creatorId: "user-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

const makeIssue = (overrides: Partial<LinearIssueData> = {}): LinearIssueData => ({
  id: "issue-1",
  identifier: "ENG-1",
  title: "Implement feature X",
  description: "A detailed description of feature X.",
  url: "https://linear.app/team/issue/ENG-1",
  priority: 2,
  priorityLabel: "High",
  estimate: 3,
  branchName: "eng-1-implement-feature-x",
  state: { id: "state-1", name: "In Progress", type: "started" },
  parentId: null,
  childIds: [],
  relations: [],
  inverseRelations: [],
  delegateId: "agent-1",
  assigneeId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  completedAt: null,
  canceledAt: null,
  ...overrides,
})

// ---------------------------------------------------------------------------
// findActiveSessionsForIssue
// ---------------------------------------------------------------------------

describe("findActiveSessionsForIssue", () => {
  test("returns active sessions for the given issue", () => {
    const sessions = [
      makeSession({ id: "s1", issueId: "issue-1", status: "active" }),
      makeSession({ id: "s2", issueId: "issue-2", status: "active" }),
      makeSession({ id: "s3", issueId: "issue-1", status: "pending" }),
    ]

    const result = findActiveSessionsForIssue("issue-1", sessions)
    expect(result.map((s) => s.id)).toEqual(["s1", "s3"])
  })

  test("excludes terminal sessions (complete, error, stale)", () => {
    const sessions = [
      makeSession({ id: "s1", issueId: "issue-1", status: "complete" }),
      makeSession({ id: "s2", issueId: "issue-1", status: "error" }),
      makeSession({ id: "s3", issueId: "issue-1", status: "stale" }),
      makeSession({ id: "s4", issueId: "issue-1", status: "active" }),
    ]

    const result = findActiveSessionsForIssue("issue-1", sessions)
    expect(result.map((s) => s.id)).toEqual(["s4"])
  })

  test("sorts newest first", () => {
    const sessions = [
      makeSession({
        id: "s-old",
        issueId: "issue-1",
        status: "active",
        createdAt: new Date("2025-01-01"),
      }),
      makeSession({
        id: "s-new",
        issueId: "issue-1",
        status: "active",
        createdAt: new Date("2025-06-01"),
      }),
    ]

    const result = findActiveSessionsForIssue("issue-1", sessions)
    expect(result[0]!.id).toBe("s-new")
    expect(result[1]!.id).toBe("s-old")
  })

  test("returns empty for issue with no sessions", () => {
    const sessions = [
      makeSession({ id: "s1", issueId: "other-issue", status: "active" }),
    ]

    const result = findActiveSessionsForIssue("issue-1", sessions)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

describe("isTerminal", () => {
  test("completed issue is terminal", () => {
    expect(isTerminal(makeIssue({ completedAt: new Date() }))).toBe(true)
  })

  test("canceled issue is terminal", () => {
    expect(isTerminal(makeIssue({ canceledAt: new Date() }))).toBe(true)
  })

  test("issue with completed state type is terminal", () => {
    expect(
      isTerminal(
        makeIssue({ state: { id: "s", name: "Done", type: "completed" } }),
      ),
    ).toBe(true)
  })

  test("issue with canceled state type is terminal", () => {
    expect(
      isTerminal(
        makeIssue({ state: { id: "s", name: "Canceled", type: "canceled" } }),
      ),
    ).toBe(true)
  })

  test("issue with duplicate state type is terminal", () => {
    expect(
      isTerminal(
        makeIssue({ state: { id: "s", name: "Duplicate", type: "duplicate" } }),
      ),
    ).toBe(true)
  })

  test("in-progress issue is not terminal", () => {
    expect(isTerminal(makeIssue())).toBe(false)
  })

  test("backlog issue is not terminal", () => {
    expect(
      isTerminal(
        makeIssue({ state: { id: "s", name: "Backlog", type: "backlog" } }),
      ),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildPromptFromIssue
// ---------------------------------------------------------------------------

describe("buildPromptFromIssue", () => {
  test("includes title", () => {
    const prompt = buildPromptFromIssue(makeIssue({ title: "Fix the bug" }))
    expect(prompt).toContain("Fix the bug")
  })

  test("includes description when present", () => {
    const prompt = buildPromptFromIssue(
      makeIssue({
        title: "Fix the bug",
        description: "The bug causes a crash.",
      }),
    )
    expect(prompt).toContain("## Description")
    expect(prompt).toContain("The bug causes a crash.")
  })

  test("omits description section when null", () => {
    const prompt = buildPromptFromIssue(
      makeIssue({ title: "Fix the bug", description: null }),
    )
    expect(prompt).not.toContain("## Description")
  })

  test("title comes first", () => {
    const prompt = buildPromptFromIssue(
      makeIssue({
        title: "Title here",
        description: "Description here",
      }),
    )
    const titlePos = prompt.indexOf("Title here")
    const descPos = prompt.indexOf("Description here")
    expect(titlePos).toBeLessThan(descPos)
  })
})
