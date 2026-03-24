/**
 * ABOUTME: Tests for dependency-aware readiness classification and backlog
 * selection. Exercises the pure classification logic independently from
 * Linear data loading — no mock clients needed.
 */

import { describe, test, expect } from "bun:test"
import {
  classifyIssue,
  classifyAll,
  buildClassificationContext,
  isReadyWorkflowCategory,
  type ClassificationContext,
} from "../src/readiness.js"
import { selectNext, selectAllActionable, formatBacklogSummary } from "../src/backlog.js"
import type {
  LinearIssueData,
  LinearSessionData,
  CandidateWork,
} from "../src/linear/types.js"

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const makeIssue = (overrides: Partial<LinearIssueData> & { id: string; identifier: string; title: string }): LinearIssueData => ({
  description: null,
  url: `https://linear.app/issue/${overrides.identifier}`,
  priority: 3,
  priorityLabel: "Normal",
  estimate: null,
  branchName: `${overrides.identifier.toLowerCase()}-branch`,
  state: { id: "state-1", name: "In Progress", type: "started" },
  parentId: null,
  childIds: [],
  relations: [],
  inverseRelations: [],
  delegateId: "agent-001",
  assigneeId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  completedAt: null,
  canceledAt: null,
  ...overrides,
})

const makeSession = (overrides: Partial<LinearSessionData> & { id: string }): LinearSessionData => ({
  status: "active",
  appUserId: "agent-001",
  issueId: null,
  creatorId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

const makeWork = (
  issue: LinearIssueData,
  session?: Partial<LinearSessionData>,
): CandidateWork => ({
  issue,
  session: makeSession({ id: `session-${issue.id}`, issueId: issue.id, ...session }),
})

// ---------------------------------------------------------------------------
// classifyIssue — terminal
// ---------------------------------------------------------------------------

describe("classifyIssue", () => {
  describe("terminal classification", () => {
    test("completed issue is terminal", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Done",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("terminal")
    })

    test("canceled issue is terminal", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Canceled",
        canceledAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Canceled", type: "canceled" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("terminal")
    })

    test("duplicate issue is terminal", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Dup",
        state: { id: "s1", name: "Duplicate", type: "duplicate" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("terminal")
    })
  })

  // ---------------------------------------------------------------------------
  // classifyIssue — ineligible (workflow category gating)
  // ---------------------------------------------------------------------------

  describe("ineligible classification (workflow category)", () => {
    test("backlog issue is ineligible even when delegated", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Backlog item",
        state: { id: "s1", name: "Backlog", type: "backlog" },
        delegateId: "agent-001",
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("ineligible")
      expect(result.reason).toContain("backlog")
    })

    test("triage issue is ineligible", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Triage item",
        state: { id: "s1", name: "Triage", type: "triage" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("ineligible")
      expect(result.reason).toContain("triage")
    })

    test("issue with null state is ineligible", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "No state",
        state: null,
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("ineligible")
      expect(result.reason).toContain("unknown")
    })

    test("unstarted (Todo) issue is eligible and becomes actionable", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Todo task",
        state: { id: "s1", name: "Todo", type: "unstarted" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("started (In Progress) issue is eligible and becomes actionable", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "In progress task",
        state: { id: "s1", name: "In Progress", type: "started" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("terminal takes precedence over ineligible", () => {
      // A completed backlog-type issue should be terminal, not ineligible
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Done backlog",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("terminal")
    })
  })

  // ---------------------------------------------------------------------------
  // classifyIssue — error-held
  // ---------------------------------------------------------------------------

  describe("error-held classification", () => {
    test("issue with error session status is error-held", () => {
      const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Errored" })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "error", ctx)
      expect(result.readiness).toBe("error-held")
    })

    test("issue in errorHeldIds set is error-held", () => {
      const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Errored" })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(["i1"]),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("error-held")
    })

    test("terminal takes precedence over error-held", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Done",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(["i1"]),
      }
      const result = classifyIssue(issue, "error", ctx)
      expect(result.readiness).toBe("terminal")
    })
  })

  // ---------------------------------------------------------------------------
  // classifyIssue — blocked by explicit relations
  // ---------------------------------------------------------------------------

  describe("blocked by explicit relations", () => {
    test("issue blocked by non-terminal issue is blocked", () => {
      const blocker = makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Blocked task",
        inverseRelations: [
          { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
        ],
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [issue.id, issue],
          [blocker.id, blocker],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("blocked")
      expect(result.reason).toContain("ENG-10")
    })

    test("issue blocked by terminal issue is NOT blocked", () => {
      const blocker = makeIssue({
        id: "i-blocker", identifier: "ENG-10", title: "Done blocker",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
      })
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Unblocked task",
        inverseRelations: [
          { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
        ],
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [issue.id, issue],
          [blocker.id, blocker],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("issue with 'related' relation is not blocked", () => {
      const related = makeIssue({ id: "i-rel", identifier: "ENG-20", title: "Related" })
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Task",
        inverseRelations: [
          { issueId: "i-rel", relatedIssueId: "i1", type: "related" },
        ],
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [issue.id, issue],
          [related.id, related],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("unknown blocker (not in context) conservatively blocks", () => {
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Blocked by unknown",
        inverseRelations: [
          { issueId: "i-unknown", relatedIssueId: "i1", type: "blocks" },
        ],
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("blocked")
      expect(result.reason).toContain("unknown")
    })

    test("issue blocked by multiple issues — one terminal, one not — is still blocked", () => {
      const terminalBlocker = makeIssue({
        id: "i-done", identifier: "ENG-10", title: "Done",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
      })
      const activeBlocker = makeIssue({ id: "i-active", identifier: "ENG-11", title: "Active" })
      const issue = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Blocked",
        inverseRelations: [
          { issueId: "i-done", relatedIssueId: "i1", type: "blocks" },
          { issueId: "i-active", relatedIssueId: "i1", type: "blocks" },
        ],
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [issue.id, issue],
          [terminalBlocker.id, terminalBlocker],
          [activeBlocker.id, activeBlocker],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("blocked")
      expect(result.reason).toContain("ENG-11")
    })
  })

  // ---------------------------------------------------------------------------
  // classifyIssue — blocked by parent
  // ---------------------------------------------------------------------------

  describe("blocked by parent structure", () => {
    test("child is blocked when parent is blocked", () => {
      const topBlocker = makeIssue({ id: "i-top", identifier: "ENG-50", title: "Top blocker" })
      const parent = makeIssue({
        id: "i-parent", identifier: "ENG-100", title: "Parent",
        childIds: ["i1"],
        inverseRelations: [
          { issueId: "i-top", relatedIssueId: "i-parent", type: "blocks" },
        ],
      })
      const child = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Child",
        parentId: "i-parent",
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [child.id, child],
          [parent.id, parent],
          [topBlocker.id, topBlocker],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(child, "active", ctx)
      expect(result.readiness).toBe("blocked")
      expect(result.reason).toContain("parent")
      expect(result.reason).toContain("ENG-100")
    })

    test("child is actionable when parent is not blocked", () => {
      const parent = makeIssue({
        id: "i-parent", identifier: "ENG-100", title: "Parent",
        childIds: ["i1"],
      })
      const child = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Child",
        parentId: "i-parent",
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [child.id, child],
          [parent.id, parent],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(child, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("child is actionable when parent is terminal", () => {
      const parent = makeIssue({
        id: "i-parent", identifier: "ENG-100", title: "Parent done",
        completedAt: new Date("2025-06-01"),
        state: { id: "s1", name: "Done", type: "completed" },
        childIds: ["i1"],
      })
      const child = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Child",
        parentId: "i-parent",
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([
          [child.id, child],
          [parent.id, parent],
        ]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(child, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("child with unknown parent is actionable (not conservative)", () => {
      const child = makeIssue({
        id: "i1", identifier: "ENG-1", title: "Child",
        parentId: "i-unknown-parent",
      })
      const ctx: ClassificationContext = {
        issuesById: new Map([[child.id, child]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(child, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })
  })

  // ---------------------------------------------------------------------------
  // classifyIssue — actionable
  // ---------------------------------------------------------------------------

  describe("actionable classification", () => {
    test("simple issue with no relations is actionable", () => {
      const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "active", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("issue with pending session is actionable", () => {
      const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, "pending", ctx)
      expect(result.readiness).toBe("actionable")
    })

    test("issue with null session status is actionable", () => {
      const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
      const ctx: ClassificationContext = {
        issuesById: new Map([[issue.id, issue]]),
        errorHeldIds: new Set(),
      }
      const result = classifyIssue(issue, null, ctx)
      expect(result.readiness).toBe("actionable")
    })
  })
})

// ---------------------------------------------------------------------------
// classifyAll
// ---------------------------------------------------------------------------

describe("classifyAll", () => {
  test("classifies a mixed batch correctly", () => {
    const actionableIssue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const terminalIssue = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Done",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })
    const blockerIssue = makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })
    const blockedIssue = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Blocked",
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i3", type: "blocks" },
      ],
    })

    const candidates: CandidateWork[] = [
      makeWork(actionableIssue),
      makeWork(terminalIssue),
      makeWork(blockedIssue),
    ]

    // Need to include the blocker in context
    const ctx = buildClassificationContext(candidates, [blockerIssue])
    const classified = classifyAll(candidates, ctx)

    expect(classified).toHaveLength(3)
    expect(classified[0]!.readiness).toBe("actionable")
    expect(classified[1]!.readiness).toBe("terminal")
    expect(classified[2]!.readiness).toBe("blocked")
  })

  test("builds context automatically when not provided", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const candidates: CandidateWork[] = [makeWork(issue)]
    const classified = classifyAll(candidates)

    expect(classified).toHaveLength(1)
    expect(classified[0]!.readiness).toBe("actionable")
  })
})

// ---------------------------------------------------------------------------
// buildClassificationContext
// ---------------------------------------------------------------------------

describe("buildClassificationContext", () => {
  test("populates issuesById from candidates", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const candidates: CandidateWork[] = [makeWork(issue)]
    const ctx = buildClassificationContext(candidates)

    expect(ctx.issuesById.get("i1")).toBe(issue)
  })

  test("includes additional issues in context", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const extra = makeIssue({ id: "i-extra", identifier: "ENG-99", title: "Extra" })
    const candidates: CandidateWork[] = [makeWork(issue)]
    const ctx = buildClassificationContext(candidates, [extra])

    expect(ctx.issuesById.get("i-extra")).toBe(extra)
  })

  test("detects error-held issues from session status", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Errored" })
    const candidates: CandidateWork[] = [makeWork(issue, { status: "error" })]
    const ctx = buildClassificationContext(candidates)

    expect(ctx.errorHeldIds.has("i1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectNext
// ---------------------------------------------------------------------------

describe("selectNext", () => {
  test("returns actionable issue as next", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const candidates: CandidateWork[] = [makeWork(issue)]
    const result = selectNext(candidates)

    expect(result.next).not.toBeNull()
    expect(result.next!.issue.identifier).toBe("ENG-1")
    expect(result.summary.actionable).toBe(1)
  })

  test("returns null when all issues are blocked", () => {
    const blocker = makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })
    const blocked = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Blocked",
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
      ],
    })
    const candidates: CandidateWork[] = [makeWork(blocked)]
    const ctx = buildClassificationContext(candidates, [blocker])
    const result = selectNext(candidates, ctx)

    expect(result.next).toBeNull()
    expect(result.summary.blocked).toBe(1)
    expect(result.summary.actionable).toBe(0)
  })

  test("returns null when all issues are terminal", () => {
    const terminal = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Done",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })
    const candidates: CandidateWork[] = [makeWork(terminal)]
    const result = selectNext(candidates)

    expect(result.next).toBeNull()
    expect(result.summary.terminal).toBe(1)
  })

  test("returns null when all issues are error-held", () => {
    const errored = makeIssue({ id: "i1", identifier: "ENG-1", title: "Errored" })
    const candidates: CandidateWork[] = [makeWork(errored, { status: "error" })]
    const result = selectNext(candidates)

    expect(result.next).toBeNull()
    expect(result.summary.errorHeld).toBe(1)
  })

  test("returns null for empty candidates", () => {
    const result = selectNext([])

    expect(result.next).toBeNull()
    expect(result.summary.total).toBe(0)
  })

  test("selects highest priority actionable issue", () => {
    const low = makeIssue({ id: "i1", identifier: "ENG-1", title: "Low", priority: 4 })
    const high = makeIssue({ id: "i2", identifier: "ENG-2", title: "High", priority: 1 })
    const med = makeIssue({ id: "i3", identifier: "ENG-3", title: "Med", priority: 2 })

    const candidates: CandidateWork[] = [makeWork(low), makeWork(high), makeWork(med)]
    const result = selectNext(candidates)

    expect(result.next!.issue.identifier).toBe("ENG-2")
  })

  test("breaks priority ties by creation date (FIFO)", () => {
    const older = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Older",
      priority: 2, createdAt: new Date("2025-01-01"),
    })
    const newer = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Newer",
      priority: 2, createdAt: new Date("2025-06-01"),
    })

    const candidates: CandidateWork[] = [makeWork(newer), makeWork(older)]
    const result = selectNext(candidates)

    expect(result.next!.issue.identifier).toBe("ENG-1")
  })

  test("skips blocked and picks actionable from mixed bag", () => {
    const blocker = makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })
    const blocked = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Blocked",
      priority: 1,
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
      ],
    })
    const actionable = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Actionable",
      priority: 3,
    })

    const candidates: CandidateWork[] = [makeWork(blocked), makeWork(actionable)]
    const ctx = buildClassificationContext(candidates, [blocker])
    const result = selectNext(candidates, ctx)

    expect(result.next!.issue.identifier).toBe("ENG-2")
    expect(result.summary.blocked).toBe(1)
    expect(result.summary.actionable).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// selectAllActionable
// ---------------------------------------------------------------------------

describe("selectAllActionable", () => {
  test("returns all actionable items in priority order", () => {
    const low = makeIssue({ id: "i1", identifier: "ENG-1", title: "Low", priority: 4 })
    const high = makeIssue({ id: "i2", identifier: "ENG-2", title: "High", priority: 1 })
    const blocked = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Blocked",
      inverseRelations: [{ issueId: "i-unknown", relatedIssueId: "i3", type: "blocks" }],
    })

    const candidates: CandidateWork[] = [makeWork(low), makeWork(high), makeWork(blocked)]
    const result = selectAllActionable(candidates)

    // next is the highest priority actionable
    expect(result.next!.issue.identifier).toBe("ENG-2")
    expect(result.summary.actionable).toBe(2)
    expect(result.summary.blocked).toBe(1)

    // Verify the classified list contains all actionable items
    const actionable = result.classified.filter((c) => c.readiness === "actionable")
    const actionableIds = actionable.map((c) => c.work.issue.identifier).sort()
    expect(actionableIds).toEqual(["ENG-1", "ENG-2"])
  })
})

// ---------------------------------------------------------------------------
// formatBacklogSummary
// ---------------------------------------------------------------------------

describe("formatBacklogSummary", () => {
  test("formats a summary with next item", () => {
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" })
    const candidates: CandidateWork[] = [makeWork(issue)]
    const selection = selectNext(candidates)
    const formatted = formatBacklogSummary(selection)

    expect(formatted).toContain("1 total")
    expect(formatted).toContain("1 actionable")
    expect(formatted).toContain("ENG-1")
  })

  test("formats a summary with no next item", () => {
    const selection = selectNext([])
    const formatted = formatBacklogSummary(selection)

    expect(formatted).toContain("0 total")
    expect(formatted).toContain("no actionable work")
  })

  test("lists skipped items with reasons", () => {
    const blocker = makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })
    const blocked = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Blocked",
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
      ],
    })
    const candidates: CandidateWork[] = [makeWork(blocked)]
    const ctx = buildClassificationContext(candidates, [blocker])
    const selection = selectNext(candidates, ctx)
    const formatted = formatBacklogSummary(selection)

    expect(formatted).toContain("skip ENG-1")
    expect(formatted).toContain("blocked")
  })

  test("includes ineligible count in summary", () => {
    const backlogIssue = makeIssue({
      id: "i-bl", identifier: "ENG-BL", title: "Backlog item",
      state: { id: "s1", name: "Backlog", type: "backlog" },
    })
    const actionableIssue = makeIssue({
      id: "i-act", identifier: "ENG-ACT", title: "Actionable",
      state: { id: "s2", name: "In Progress", type: "started" },
    })
    const candidates: CandidateWork[] = [makeWork(backlogIssue), makeWork(actionableIssue)]
    const selection = selectNext(candidates)
    const formatted = formatBacklogSummary(selection)

    expect(formatted).toContain("1 ineligible")
    expect(formatted).toContain("1 actionable")
    expect(formatted).toContain("ENG-ACT")
    expect(selection.summary.ineligible).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// isReadyWorkflowCategory
// ---------------------------------------------------------------------------

describe("isReadyWorkflowCategory", () => {
  test("unstarted (Todo) is ready", () => {
    expect(isReadyWorkflowCategory("unstarted")).toBe(true)
  })

  test("started (In Progress) is ready", () => {
    expect(isReadyWorkflowCategory("started")).toBe(true)
  })

  test("backlog is not ready", () => {
    expect(isReadyWorkflowCategory("backlog")).toBe(false)
  })

  test("triage is not ready", () => {
    expect(isReadyWorkflowCategory("triage")).toBe(false)
  })

  test("completed is not ready", () => {
    expect(isReadyWorkflowCategory("completed")).toBe(false)
  })

  test("canceled is not ready", () => {
    expect(isReadyWorkflowCategory("canceled")).toBe(false)
  })

  test("duplicate is not ready", () => {
    expect(isReadyWorkflowCategory("duplicate")).toBe(false)
  })

  test("null is not ready", () => {
    expect(isReadyWorkflowCategory(null)).toBe(false)
  })

  test("undefined is not ready", () => {
    expect(isReadyWorkflowCategory(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Backlog issues — explicit exclusion from readiness
// ---------------------------------------------------------------------------

describe("backlog exclusion from readiness", () => {
  test("delegated backlog issue is not selected as next work", () => {
    const backlogIssue = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Backlog task",
      state: { id: "s1", name: "Backlog", type: "backlog" },
      delegateId: "agent-001",
      priority: 1,
    })
    const candidates: CandidateWork[] = [makeWork(backlogIssue)]
    const result = selectNext(candidates)

    expect(result.next).toBeNull()
    expect(result.summary.ineligible).toBe(1)
    expect(result.summary.actionable).toBe(0)
  })

  test("backlog issues are skipped in favor of Todo/In Progress issues", () => {
    const backlogIssue = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Backlog",
      state: { id: "s1", name: "Backlog", type: "backlog" },
      priority: 1, // Higher priority
    })
    const todoIssue = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Todo",
      state: { id: "s2", name: "Todo", type: "unstarted" },
      priority: 4, // Lower priority
    })
    const candidates: CandidateWork[] = [makeWork(backlogIssue), makeWork(todoIssue)]
    const result = selectNext(candidates)

    expect(result.next!.issue.identifier).toBe("ENG-2")
    expect(result.summary.ineligible).toBe(1)
    expect(result.summary.actionable).toBe(1)
  })

  test("mixed backlog, triage, and actionable issues classify correctly", () => {
    const backlog = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Backlog",
      state: { id: "s1", name: "Backlog", type: "backlog" },
    })
    const triage = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Triage",
      state: { id: "s2", name: "Triage", type: "triage" },
    })
    const inProgress = makeIssue({
      id: "i3", identifier: "ENG-3", title: "In Progress",
      state: { id: "s3", name: "In Progress", type: "started" },
    })
    const todo = makeIssue({
      id: "i4", identifier: "ENG-4", title: "Todo",
      state: { id: "s4", name: "Todo", type: "unstarted" },
    })

    const candidates: CandidateWork[] = [
      makeWork(backlog), makeWork(triage), makeWork(inProgress), makeWork(todo),
    ]
    const classified = classifyAll(candidates)

    expect(classified[0]!.readiness).toBe("ineligible") // backlog
    expect(classified[1]!.readiness).toBe("ineligible") // triage
    expect(classified[2]!.readiness).toBe("actionable") // started
    expect(classified[3]!.readiness).toBe("actionable") // unstarted
  })
})
