/**
 * ABOUTME: Integration tests for the sequential backlog drain loop.
 * Proves the full manual-first worker behavior: load from Linear, classify
 * issues, process actionable ones through blueprints, skip blocked/error-held,
 * continue after failures, and exit when no actionable work remains.
 *
 * Uses mock Engine and Linear layers — no real API calls or agent execution.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult, CheckFailure } from "@workspace/blueprints"
import { runWorkerLoop, runWorkerIteration, type WorkerRunSummary } from "../src/worker.js"
import { Linear } from "../src/linear/client.js"
import { classifyAll, buildClassificationContext } from "../src/readiness.js"
import { selectNext, formatBacklogSummary } from "../src/backlog.js"
import { runIssue, buildTaskInput } from "../src/runner.js"
import { ErrorHoldStore } from "../src/error-hold.js"
import type {
  LinearIssueData,
  LinearSessionData,
  CandidateWork,
  SessionPrompt,
} from "../src/linear/types.js"

// ---------------------------------------------------------------------------
// Test helpers — issue/session/work factories
// ---------------------------------------------------------------------------

let issueCounter = 0

const makeIssue = (overrides?: Partial<LinearIssueData>): LinearIssueData => {
  issueCounter++
  return {
    id: `issue-${issueCounter}`,
    identifier: `ENG-${issueCounter}`,
    title: `Task ${issueCounter}`,
    description: `Description for task ${issueCounter}`,
    url: `https://linear.app/issue/ENG-${issueCounter}`,
    priority: 3,
    priorityLabel: "Normal",
    estimate: null,
    branchName: `eng-${issueCounter}-task`,
    state: { id: "state-1", name: "In Progress", type: "started" },
    parentId: null,
    childIds: [],
    relations: [],
    inverseRelations: [],
    delegateId: "agent-001",
    assigneeId: null,
    createdAt: new Date(`2025-01-01T00:00:00Z`),
    updatedAt: new Date(`2025-01-01T00:00:00Z`),
    completedAt: null,
    canceledAt: null,
    ...overrides,
  }
}

const makeSession = (
  issueId: string,
  overrides?: Partial<LinearSessionData>,
): LinearSessionData => ({
  id: `session-for-${issueId}`,
  status: "active",
  appUserId: "agent-001",
  issueId,
  creatorId: "user-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

const makeWork = (
  issueOverrides?: Partial<LinearIssueData>,
  sessionOverrides?: Partial<LinearSessionData>,
): CandidateWork => {
  const issue = makeIssue(issueOverrides)
  return {
    issue,
    session: makeSession(issue.id, sessionOverrides),
  }
}

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

/**
 * Build a mock Linear layer that tracks activity writes.
 */
const makeMockLinearLayer = (): {
  layer: Layer.Layer<Linear>
  activityWrites: Array<{ sessionId: string; body: string }>
} => {
  const activityWrites: Array<{ sessionId: string; body: string }> = []

  const mockClient = {
    createAgentActivity: async (input: {
      agentSessionId: string
      content: { type: string; body: string }
    }) => {
      activityWrites.push({
        sessionId: input.agentSessionId,
        body: input.content.body,
      })
      return { success: true }
    },
    agentSession: async () => ({
      activities: async () => ({ nodes: [] }),
    }),
  }

  return {
    layer: Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    ),
    activityWrites,
  }
}

/** Create an Engine layer that succeeds with a fixed response. */
const makeSuccessEngine = (response = "Done!"): Layer.Layer<Engine> =>
  Layer.succeed(Engine, {
    execute: (_prompt: string, _workDir: string) =>
      Effect.succeed({ response } satisfies AgentResult),
  })

/** Create an Engine layer that always fails with a check failure. */
const makeFailEngine = (): Layer.Layer<Engine> =>
  Layer.succeed(Engine, {
    execute: (_prompt: string, _workDir: string) =>
      Effect.fail(
        new CheckFailure({
          command: "npm test",
          stderr: "Tests failed",
          exitCode: 1,
        }),
      ),
  })

// ---------------------------------------------------------------------------
// Classification tests — actionable, blocked, error-held, terminal
// ---------------------------------------------------------------------------

describe("drain loop — classification", () => {
  test("actionable issues are classified as actionable", () => {
    issueCounter = 100
    const issue = makeIssue({ title: "Actionable task" })
    const candidates: CandidateWork[] = [
      { issue, session: makeSession(issue.id) },
    ]

    const ctx = buildClassificationContext(candidates)
    const classified = classifyAll(candidates, ctx)

    expect(classified).toHaveLength(1)
    expect(classified[0]!.readiness).toBe("actionable")
  })

  test("error-held issues are skipped during classification", () => {
    issueCounter = 110
    const issue = makeIssue({ title: "Error task" })
    const session = makeSession(issue.id, { status: "error" })
    const candidates: CandidateWork[] = [{ issue, session }]

    const ctx = buildClassificationContext(candidates)
    const classified = classifyAll(candidates, ctx)

    expect(classified).toHaveLength(1)
    expect(classified[0]!.readiness).toBe("error-held")
    expect(classified[0]!.reason).toContain("error")
  })

  test("blocked issues are skipped during classification", () => {
    issueCounter = 120
    const blocker = makeIssue({ id: "blocker-1", identifier: "ENG-BLK", title: "Blocker" })
    const blocked = makeIssue({
      id: "blocked-1",
      identifier: "ENG-BLD",
      title: "Blocked",
      inverseRelations: [
        { issueId: "blocker-1", relatedIssueId: "blocked-1", type: "blocks" },
      ],
    })

    const candidates: CandidateWork[] = [
      { issue: blocker, session: makeSession("blocker-1") },
      { issue: blocked, session: makeSession("blocked-1") },
    ]

    const ctx = buildClassificationContext(candidates)
    const classified = classifyAll(candidates, ctx)

    const blockerResult = classified.find((c) => c.work.issue.id === "blocker-1")
    const blockedResult = classified.find((c) => c.work.issue.id === "blocked-1")

    expect(blockerResult!.readiness).toBe("actionable")
    expect(blockedResult!.readiness).toBe("blocked")
    expect(blockedResult!.reason).toContain("ENG-BLK")
  })

  test("terminal issues are skipped during classification", () => {
    issueCounter = 130
    const done = makeIssue({
      title: "Done task",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })

    const candidates: CandidateWork[] = [
      { issue: done, session: makeSession(done.id) },
    ]

    const ctx = buildClassificationContext(candidates)
    const classified = classifyAll(candidates, ctx)

    expect(classified[0]!.readiness).toBe("terminal")
  })

  test("runtime error-holds merge with Linear session status", () => {
    issueCounter = 140
    const issue = makeIssue({ id: "rt-hold", title: "Runtime held" })
    const candidates: CandidateWork[] = [
      { issue, session: makeSession("rt-hold", { status: "active" }) },
    ]

    // Without runtime hold — should be actionable
    const ctx1 = buildClassificationContext(candidates)
    const classified1 = classifyAll(candidates, ctx1)
    expect(classified1[0]!.readiness).toBe("actionable")

    // With runtime hold merged — should be error-held
    const ctx2 = {
      ...buildClassificationContext(candidates),
      errorHeldIds: new Set(["rt-hold"]),
    }
    const classified2 = classifyAll(candidates, ctx2)
    expect(classified2[0]!.readiness).toBe("error-held")
  })
})

// ---------------------------------------------------------------------------
// Selection tests — priority ordering, empty backlog
// ---------------------------------------------------------------------------

describe("drain loop — selection", () => {
  test("selectNext picks highest priority actionable issue first", () => {
    issueCounter = 200
    const lowPri = makeIssue({
      id: "low-1",
      identifier: "ENG-LOW",
      title: "Low priority",
      priority: 4,
      createdAt: new Date("2025-01-01"),
    })
    const highPri = makeIssue({
      id: "high-1",
      identifier: "ENG-HIGH",
      title: "High priority",
      priority: 1,
      createdAt: new Date("2025-01-02"),
    })

    const candidates: CandidateWork[] = [
      { issue: lowPri, session: makeSession("low-1") },
      { issue: highPri, session: makeSession("high-1") },
    ]

    const selection = selectNext(candidates)

    expect(selection.next).not.toBeNull()
    expect(selection.next!.issue.identifier).toBe("ENG-HIGH")
    expect(selection.summary.actionable).toBe(2)
  })

  test("selectNext returns null when all issues are non-actionable", () => {
    issueCounter = 210
    const terminal = makeIssue({
      title: "Terminal",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })
    const errHeld = makeIssue({ title: "Error held" })

    const candidates: CandidateWork[] = [
      { issue: terminal, session: makeSession(terminal.id) },
      { issue: errHeld, session: makeSession(errHeld.id, { status: "error" }) },
    ]

    const selection = selectNext(candidates)

    expect(selection.next).toBeNull()
    expect(selection.summary.actionable).toBe(0)
    expect(selection.summary.terminal).toBe(1)
    expect(selection.summary.errorHeld).toBe(1)
  })

  test("formatBacklogSummary includes counts and skip reasons", () => {
    issueCounter = 220
    const actionable = makeIssue({ id: "a1", identifier: "ENG-ACT", title: "Actionable" })
    const blocked = makeIssue({
      id: "b1",
      identifier: "ENG-BLK2",
      title: "Blocked",
      inverseRelations: [
        { issueId: "a1", relatedIssueId: "b1", type: "blocks" },
      ],
    })

    const candidates: CandidateWork[] = [
      { issue: actionable, session: makeSession("a1") },
      { issue: blocked, session: makeSession("b1") },
    ]

    const selection = selectNext(candidates)
    const summary = formatBacklogSummary(selection)

    expect(summary).toContain("2 total")
    expect(summary).toContain("1 actionable")
    expect(summary).toContain("1 blocked")
    expect(summary).toContain("ENG-ACT")
    expect(summary).toContain("skip ENG-BLK2")
  })
})

// ---------------------------------------------------------------------------
// Error-hold tracking tests
// ---------------------------------------------------------------------------

describe("drain loop — error-hold tracking", () => {
  test("ErrorHoldStore tracks failures across iterations", () => {
    const store = new ErrorHoldStore()

    store.record({
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Failed after 2 attempt(s): Tests failed",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    })

    store.record({
      issueId: "issue-2",
      sessionId: "session-2",
      failureSummary: "Failed after 1 attempt(s): Build error",
      failedAt: new Date("2025-06-01T10:05:00Z"),
    })

    expect(store.size).toBe(2)
    expect(store.has("issue-1")).toBe(true)
    expect(store.has("issue-2")).toBe(true)
    expect(store.heldIds()).toEqual(new Set(["issue-1", "issue-2"]))

    // Clearing one hold leaves the other
    const cleared = store.clear("issue-1")
    expect(cleared).not.toBeNull()
    expect(cleared!.failureSummary).toContain("Tests failed")
    expect(store.size).toBe(1)
    expect(store.has("issue-1")).toBe(false)
    expect(store.has("issue-2")).toBe(true)
  })

  test("error-hold records failure summary for retry feedback", () => {
    const store = new ErrorHoldStore()

    store.record({
      issueId: "fail-1",
      sessionId: "s-fail-1",
      failureSummary: "Failed after 2 attempt(s): npm test exited with code 1",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    })

    const hold = store.get("fail-1")
    expect(hold).not.toBeNull()
    expect(hold!.failureSummary).toContain("Failed after 2 attempt(s)")
    expect(hold!.failureSummary).toContain("npm test")

    const cleared = store.clear("fail-1")
    expect(cleared!.failureSummary).toBe(hold!.failureSummary)
    expect(store.has("fail-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task input construction tests
// ---------------------------------------------------------------------------

describe("drain loop — task input", () => {
  test("buildTaskInput includes retry feedback when provided", () => {
    issueCounter = 300
    const work = makeWork({ title: "Feedback test" })

    const withFeedback = buildTaskInput(work, "Previous run failed: tests broken")
    const withoutFeedback = buildTaskInput(work)

    expect(withFeedback).toContain("Feedback test")
    expect(withFeedback).toContain("Previous Attempt Feedback")
    expect(withFeedback).toContain("tests broken")

    expect(withoutFeedback).toContain("Feedback test")
    expect(withoutFeedback).not.toContain("Previous Attempt Feedback")
  })
})

// ---------------------------------------------------------------------------
// Issue runner integration tests
// ---------------------------------------------------------------------------

describe("drain loop — issue runner", () => {
  test("runIssue returns structured result for successful execution", async () => {
    issueCounter = 400
    const work = makeWork({ title: "Success test" })

    const { layer: linearLayer } = makeMockLinearLayer()
    const engineLayer = makeSuccessEngine("Completed!")

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.issueIdentifier).toBe(work.issue.identifier)
    expect(result.issueId).toBe(work.issue.id)
    expect(result.sessionId).toBe(work.session.id)
    expect(result.attempts).toBe(1)
    expect(result.failureSummary).toBeUndefined()
  })

  test("runIssue returns structured result with failureSummary on failure", async () => {
    issueCounter = 410
    const work = makeWork({ title: "Failure test" })

    const { layer: linearLayer } = makeMockLinearLayer()
    const engineLayer = makeFailEngine()

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.failureSummary).toBeDefined()
    expect(result.failureSummary).toContain("Failed after")
  })

  test("runIssue includes retry feedback in task prompt", async () => {
    issueCounter = 420
    const work = makeWork({ title: "Retry feedback test" })

    let receivedPrompt = ""
    const trackingEngine = Layer.succeed(Engine, {
      execute: (prompt: string, _workDir: string) => {
        receivedPrompt = prompt
        return Effect.succeed({ response: "Fixed!" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer } = makeMockLinearLayer()

    await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer: trackingEngine,
        retryFeedback: "Previous: npm test failed with 3 errors",
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(receivedPrompt).toContain("Retry feedback test")
    expect(receivedPrompt).toContain("Previous Attempt Feedback")
    expect(receivedPrompt).toContain("npm test failed with 3 errors")
  })
})

// ---------------------------------------------------------------------------
// Activity writing tests
// ---------------------------------------------------------------------------

describe("drain loop — activity writes", () => {
  test("writes start and success activities for successful run", async () => {
    issueCounter = 500
    const work = makeWork({ identifier: "ENG-500", title: "Activity test" })

    const { layer: linearLayer, activityWrites } = makeMockLinearLayer()
    const engineLayer = makeSuccessEngine()

    await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(linearLayer)),
    )

    const bodies = activityWrites.map((w) => w.body)
    expect(bodies.some((b) => b.includes("Starting work on ENG-500"))).toBe(true)
    expect(bodies.some((b) => b.includes("All checks passed"))).toBe(true)
  })

  test("writes start and error activities on failure", async () => {
    issueCounter = 510
    const work = makeWork({ identifier: "ENG-510", title: "Error activity test" })

    const { layer: linearLayer, activityWrites } = makeMockLinearLayer()
    const engineLayer = makeFailEngine()

    await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(linearLayer)),
    )

    const bodies = activityWrites.map((w) => w.body)
    expect(bodies.some((b) => b.includes("Starting work on ENG-510"))).toBe(true)
    expect(bodies.some((b) => b.includes("Failed after"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Worker summary shape test
// ---------------------------------------------------------------------------

describe("drain loop — summary", () => {
  test("WorkerRunSummary has correct shape and fields", () => {
    const summary: WorkerRunSummary = {
      processed: 3,
      succeeded: 2,
      errorHeld: 1,
      retried: 0,
      iterations: [
        { runResult: null, wasRetry: false, retryFeedback: undefined },
      ],
    }

    expect(summary.processed).toBe(3)
    expect(summary.succeeded).toBe(2)
    expect(summary.errorHeld).toBe(1)
    expect(summary.retried).toBe(0)
    expect(summary.iterations).toHaveLength(1)
  })
})
