/**
 * ABOUTME: Close-out acceptance tests for the Linear-backed worker model.
 *
 * These tests prove the tightened blueprints + ralphly model is ready for
 * the later ralphe migration. They operate at a higher level than the
 * existing unit tests, exercising end-to-end worker semantics and
 * operator-visible behavior across the full stack:
 *
 * 1. Blueprints contract alignment — the documented runner contract
 *    (retry with feedback, lifecycle events, result shaping) matches
 *    what ralphly's runner actually receives.
 *
 * 2. Linear-backed readiness and queueing — backlog selection is
 *    derived from Linear state (workflow categories, session status,
 *    activity-based error detection) rather than private memory.
 *
 * 3. Durable failure holds — error-held state persists across
 *    fresh manual runs because it is reconstructed from Linear
 *    session activities, not from an in-memory hold queue.
 *
 * 4. Same-session retry and session-write behavior — a prompted
 *    follow-up after an error clears the hold and triggers retry
 *    with prior failure feedback propagated to the next attempt.
 *
 * 5. Manual backlog draining — the worker loop processes all
 *    actionable work and stops only when no actionable issues remain,
 *    continuing past per-issue failures.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import {
  Engine,
  CheckFailure,
  FatalError,
  run as blueprintsRun,
  type AgentResult,
  type RunConfig,
  type LoopEvent,
} from "@workspace/blueprints"
import {
  classifyIssue,
  classifyAll,
  buildClassificationContext,
  type ClassificationContext,
} from "../src/readiness.js"
import { selectNext, formatBacklogSummary } from "../src/backlog.js"
import { runIssue, buildTaskInput } from "../src/runner.js"
import { buildFailureSummary } from "../src/error-hold.js"
import {
  findPromptedFollowUp,
  findLastErrorTimestamp,
  findLastErrorSummary,
  isErrorActivity,
} from "../src/worker.js"
import {
  formatStartActivity,
  formatSuccessActivity,
  formatErrorActivity,
  formatCheckFailedActivity,
  mapLoopEventToActivity,
} from "../src/linear/activities.js"
import { Linear } from "../src/linear/client.js"
import type {
  LinearIssueData,
  LinearSessionData,
  CandidateWork,
  SessionPrompt,
} from "../src/linear/types.js"

// ===========================================================================
// Shared test factories
// ===========================================================================

const makeIssue = (
  overrides: Partial<LinearIssueData> & { id: string; identifier: string; title: string },
): LinearIssueData => ({
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

const makeSession = (
  overrides: Partial<LinearSessionData> & { id: string },
): LinearSessionData => ({
  status: "active",
  appUserId: "agent-001",
  issueId: null,
  creatorId: "user-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

const makeWork = (
  issue: LinearIssueData,
  sessionOverrides?: Partial<LinearSessionData>,
): CandidateWork => ({
  issue,
  session: makeSession({
    id: `session-${issue.id}`,
    issueId: issue.id,
    ...sessionOverrides,
  }),
})

interface ActivityCall {
  agentSessionId: string
  content: { type: string; body: string }
}

const makeMockLinearLayer = (): {
  layer: Layer.Layer<Linear>
  calls: ActivityCall[]
} => {
  const calls: ActivityCall[] = []
  const mockClient = {
    createAgentActivity: async (input: ActivityCall) => {
      calls.push(input)
      return { success: true }
    },
  }
  return {
    layer: Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    ),
    calls,
  }
}

const baseConfig: RunConfig = {
  maxAttempts: 2,
  checks: [],
  gitMode: "none",
  report: "none",
}

const makeEngineLayer = (
  response = "Done!",
  resumeToken?: string,
): Layer.Layer<Engine> =>
  Layer.succeed(Engine, {
    execute: (_prompt: string, _workDir: string) =>
      Effect.succeed({ response, resumeToken } satisfies AgentResult),
  })

const makeFailingEngineLayer = (
  command = "npm test",
  stderr = "Tests failed",
): Layer.Layer<Engine> =>
  Layer.succeed(Engine, {
    execute: (_prompt: string, _workDir: string) =>
      Effect.fail(
        new CheckFailure({
          command,
          stderr,
          exitCode: 1,
        }),
      ),
  })

// ===========================================================================
// 1. BLUEPRINTS CONTRACT ALIGNMENT
//
// Proves the documented blueprints contract (retry with feedback, lifecycle
// events, result shaping) remains aligned with what ralphly's runner receives.
// ===========================================================================

describe("acceptance: blueprints contract alignment", () => {
  test("runner receives success result with attempt count and resume token", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Implement feature" }),
    )

    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 3 },
        engineLayer: makeEngineLayer("Feature implemented", "resume-abc"),
      }).pipe(Effect.provide(linearLayer)),
    )

    // Contract: success=true, attempts=1 on first-pass success
    expect(result.success).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.resumeToken).toBe("resume-abc")
    expect(result.issueIdentifier).toBe("ENG-1")
    expect(result.error).toBeUndefined()
    expect(result.failureSummary).toBeUndefined()
  })

  test("runner receives failure result with error and failure summary after exhausting retries", async () => {
    const { layer: linearLayer } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-2", title: "Fix bug" }),
    )

    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 2 },
        engineLayer: makeFailingEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    // Contract: success=false after all retries exhausted
    expect(result.success).toBe(false)
    expect(result.attempts).toBe(2)
    expect(result.error).toBeDefined()
    expect(result.failureSummary).toMatch(/^Failed after 2 attempt\(s\):/)
  })

  test("blueprints feedback propagation flows through retry loop to engine", async () => {
    // Engine tracks prompts it receives across retries
    const receivedPrompts: string[] = []
    let callCount = 0

    const retryEngine = Layer.succeed(Engine, {
      execute: (prompt: string, _workDir: string) => {
        receivedPrompts.push(prompt)
        callCount++
        if (callCount === 1) {
          return Effect.fail(
            new CheckFailure({ command: "bun test", stderr: "assertion failed", exitCode: 1 }),
          )
        }
        return Effect.succeed({ response: "Fixed!" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-3", title: "Fix assertion" }),
    )

    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 3 },
        engineLayer: retryEngine,
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)
    // First prompt: no feedback
    expect(receivedPrompts[0]).toContain("Fix assertion")
    expect(receivedPrompts[0]).not.toContain("Previous attempt failed")
    // Second prompt: blueprints appended failure feedback
    expect(receivedPrompts[1]).toContain("Fix assertion")
    expect(receivedPrompts[1]).toContain("assertion failed")
  })

  test("lifecycle events follow documented sequence: attempt_start → check_failed → attempt_start → success", async () => {
    let callCount = 0
    const retryEngine = Layer.succeed(Engine, {
      execute: () => {
        callCount++
        if (callCount === 1) {
          return Effect.fail(
            new CheckFailure({ command: "lint", stderr: "unused import", exitCode: 1 }),
          )
        }
        return Effect.succeed({ response: "Fixed" } satisfies AgentResult)
      },
    })

    const events: LoopEvent[] = []
    const result = await Effect.runPromise(
      blueprintsRun({
        task: "fix lint",
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 2 },
        engineLayer: retryEngine,
        onEvent: (event) => {
          events.push(event)
          return Effect.void
        },
      }),
    )

    expect(result.success).toBe(true)
    // Documented sequence
    expect(events.map((e) => e.type)).toEqual([
      "attempt_start",
      "check_failed",
      "attempt_start",
      "success",
    ])
    // Feedback is present on the check_failed event
    expect(events[1]!.feedback).toContain("unused import")
  })

  test("fatal error propagates immediately without retry", async () => {
    let engineCalls = 0
    const fatalEngine = Layer.succeed(Engine, {
      execute: () => {
        engineCalls++
        return Effect.fail(
          new FatalError({ command: "agent", message: "auth token expired" }),
        )
      },
    })

    const result = await Effect.runPromise(
      blueprintsRun({
        task: "implement feature",
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 3 },
        engineLayer: fatalEngine,
      }),
    )

    // Fatal errors bypass the retry loop
    expect(result.success).toBe(false)
    expect(result.error).toBe("auth token expired")
    expect(engineCalls).toBe(1)
  })

  test("retry feedback from ralphly is prepended to task input on same-session retry", async () => {
    let receivedPrompt = ""
    const engine = Layer.succeed(Engine, {
      execute: (prompt: string) => {
        receivedPrompt = prompt
        return Effect.succeed({ response: "Fixed" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({
        id: "i1",
        identifier: "ENG-4",
        title: "Fix flaky test",
        description: "The test sometimes fails on CI",
      }),
    )

    await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: baseConfig,
        engineLayer: engine,
        retryFeedback: "Failed after 2 attempt(s): bun test exited with code 1\n\nUser follow-up: I added the missing fixture",
      }).pipe(Effect.provide(linearLayer)),
    )

    // Task input includes issue context AND retry feedback
    expect(receivedPrompt).toContain("Fix flaky test")
    expect(receivedPrompt).toContain("The test sometimes fails on CI")
    expect(receivedPrompt).toContain("Previous Attempt Feedback")
    expect(receivedPrompt).toContain("Failed after 2 attempt(s)")
    expect(receivedPrompt).toContain("I added the missing fixture")
  })
})

// ===========================================================================
// 2. LINEAR-BACKED READINESS AND QUEUEING
//
// Proves backlog selection is Linear-derived and respects the tightened
// readiness model: workflow category gating, session-status error-held,
// activity-derived error-held, explicit blocking, and priority ordering.
// ===========================================================================

describe("acceptance: Linear-backed readiness and queueing", () => {
  test("full backlog with mixed readiness classifies entirely from Linear state", () => {
    // Simulate a realistic backlog as it would appear from Linear
    const completedIssue = makeIssue({
      id: "i-done", identifier: "ENG-100", title: "Already done",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })
    const backlogIssue = makeIssue({
      id: "i-backlog", identifier: "ENG-101", title: "Backlog item",
      state: { id: "s2", name: "Backlog", type: "backlog" },
      priority: 1, // high priority but in backlog
    })
    const blockerIssue = makeIssue({
      id: "i-blocker", identifier: "ENG-102", title: "Prerequisite work",
      state: { id: "s3", name: "In Progress", type: "started" },
    })
    const blockedIssue = makeIssue({
      id: "i-blocked", identifier: "ENG-103", title: "Depends on prerequisite",
      state: { id: "s4", name: "Todo", type: "unstarted" },
      priority: 1,
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i-blocked", type: "blocks" },
      ],
    })
    const errorHeldIssue = makeIssue({
      id: "i-error", identifier: "ENG-104", title: "Previously failed",
    })
    const actionableHigh = makeIssue({
      id: "i-high", identifier: "ENG-105", title: "High priority task",
      priority: 2,
      createdAt: new Date("2025-03-01"),
    })
    const actionableLow = makeIssue({
      id: "i-low", identifier: "ENG-106", title: "Lower priority task",
      priority: 4,
      createdAt: new Date("2025-01-01"),
    })

    const candidates: CandidateWork[] = [
      makeWork(completedIssue),
      makeWork(backlogIssue),
      makeWork(blockedIssue),
      makeWork(errorHeldIssue, { status: "error" }),
      makeWork(actionableHigh),
      makeWork(actionableLow),
    ]

    // Build context with blocker included (as the worker would)
    const ctx = buildClassificationContext(candidates, [blockerIssue])
    const selection = selectNext(candidates, ctx)

    // Verify classification
    expect(selection.summary.terminal).toBe(1)
    expect(selection.summary.ineligible).toBe(1)
    expect(selection.summary.blocked).toBe(1)
    expect(selection.summary.errorHeld).toBe(1)
    expect(selection.summary.actionable).toBe(2)
    expect(selection.summary.total).toBe(6)

    // Verify selection: highest priority actionable issue
    expect(selection.next).not.toBeNull()
    expect(selection.next!.issue.identifier).toBe("ENG-105")

    // Verify individual classifications
    const byId = new Map(
      selection.classified.map((c) => [c.work.issue.id, c]),
    )
    expect(byId.get("i-done")!.readiness).toBe("terminal")
    expect(byId.get("i-backlog")!.readiness).toBe("ineligible")
    expect(byId.get("i-blocked")!.readiness).toBe("blocked")
    expect(byId.get("i-error")!.readiness).toBe("error-held")
    expect(byId.get("i-high")!.readiness).toBe("actionable")
    expect(byId.get("i-low")!.readiness).toBe("actionable")
  })

  test("backlog issues remain ineligible regardless of priority or delegation", () => {
    const backlog = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Backlog work",
      state: { id: "s1", name: "Backlog", type: "backlog" },
      delegateId: "agent-001",
      priority: 0, // highest possible priority
    })
    const triage = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Triage work",
      state: { id: "s2", name: "Triage", type: "triage" },
      delegateId: "agent-001",
      priority: 0,
    })
    const todoLow = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Low priority todo",
      state: { id: "s3", name: "Todo", type: "unstarted" },
      priority: 4,
    })

    const candidates = [makeWork(backlog), makeWork(triage), makeWork(todoLow)]
    const selection = selectNext(candidates)

    // Only the Todo issue is actionable despite lower priority
    expect(selection.next!.issue.identifier).toBe("ENG-3")
    expect(selection.summary.ineligible).toBe(2)
    expect(selection.summary.actionable).toBe(1)
  })

  test("activity-derived error-held state gates readiness when session status is not 'error'", () => {
    // This is the durable path: session may be "active" but activities
    // contain an unresolved error marker
    const issue = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Previously failed",
    })
    const candidates = [makeWork(issue, { status: "active" })]

    // Build context with activity-derived error-held set
    const ctx = buildClassificationContext(candidates, undefined, new Set(["i1"]))
    const selection = selectNext(candidates, ctx)

    expect(selection.next).toBeNull()
    expect(selection.summary.errorHeld).toBe(1)
    expect(selection.summary.actionable).toBe(0)
  })

  test("priority ordering respects Linear priority then FIFO creation order", () => {
    const urgent = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Urgent",
      priority: 1,
      createdAt: new Date("2025-06-01"), // newer
    })
    const normalOlder = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Normal older",
      priority: 3,
      createdAt: new Date("2025-01-01"),
    })
    const normalNewer = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Normal newer",
      priority: 3,
      createdAt: new Date("2025-03-01"),
    })

    const candidates = [
      makeWork(normalNewer),
      makeWork(urgent),
      makeWork(normalOlder),
    ]
    const selection = selectNext(candidates)

    expect(selection.next!.issue.identifier).toBe("ENG-1") // highest priority

    // Remove urgent, verify FIFO within same priority
    const normalOnly = candidates.filter((c) => c.issue.priority === 3)
    const normalSelection = selectNext(normalOnly)
    expect(normalSelection.next!.issue.identifier).toBe("ENG-2") // older first
  })

  test("blocked issues are skipped and other actionable work continues", () => {
    const blocker = makeIssue({
      id: "i-blocker", identifier: "ENG-10", title: "Prerequisite",
    })
    const blocked = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Blocked high priority",
      priority: 1,
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i1", type: "blocks" },
      ],
    })
    const unblocked = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Unblocked lower priority",
      priority: 4,
    })

    const candidates = [makeWork(blocked), makeWork(unblocked)]
    const ctx = buildClassificationContext(candidates, [blocker])
    const selection = selectNext(candidates, ctx)

    // Blocked issue is skipped; lower-priority unblocked issue is selected
    expect(selection.next!.issue.identifier).toBe("ENG-2")
    expect(selection.summary.blocked).toBe(1)

    // Verify the summary explains why
    const summary = formatBacklogSummary(selection)
    expect(summary).toContain("skip ENG-1")
    expect(summary).toContain("blocked")
    expect(summary).toContain("ENG-2")
  })

  test("classification precedence: terminal > ineligible > error-held > blocked > actionable", () => {
    // Issue that is terminal AND has error session AND is in backlog
    // Should be terminal (first check wins)
    const terminalError = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Terminal with error",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })
    const ctx1: ClassificationContext = {
      issuesById: new Map([[terminalError.id, terminalError]]),
      errorHeldIds: new Set(["i1"]),
    }
    expect(classifyIssue(terminalError, "error", ctx1).readiness).toBe("terminal")

    // Issue that is ineligible (backlog) AND has error session
    // Should be ineligible (comes before error-held)
    const backlogError = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Backlog error",
      state: { id: "s2", name: "Backlog", type: "backlog" },
    })
    const ctx2: ClassificationContext = {
      issuesById: new Map([[backlogError.id, backlogError]]),
      errorHeldIds: new Set(["i2"]),
    }
    expect(classifyIssue(backlogError, "error", ctx2).readiness).toBe("ineligible")

    // Issue that is error-held AND blocked
    // Should be error-held (comes before blocked)
    const blockerIssue = makeIssue({
      id: "i-blocker", identifier: "ENG-10", title: "Blocker",
    })
    const errorBlockedIssue = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Error and blocked",
      inverseRelations: [
        { issueId: "i-blocker", relatedIssueId: "i3", type: "blocks" },
      ],
    })
    const ctx3: ClassificationContext = {
      issuesById: new Map([
        [errorBlockedIssue.id, errorBlockedIssue],
        [blockerIssue.id, blockerIssue],
      ]),
    }
    expect(classifyIssue(errorBlockedIssue, "error", ctx3).readiness).toBe("error-held")
  })
})

// ===========================================================================
// 3. DURABLE FAILURE HOLDS ACROSS FRESH MANUAL RUNS
//
// Proves error-held state can be reconstructed entirely from Linear session
// activities, surviving process restarts. The hold mechanism is the error
// activity written by the runner — not an in-memory store.
// ===========================================================================

describe("acceptance: durable failure holds across fresh manual runs", () => {
  test("error activity written by runner is detectable as durable hold marker", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Will fail" }),
    )

    // Run fails after 2 attempts
    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 2 },
        engineLayer: makeFailingEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(false)

    // Extract the error activity from written calls
    const errorCall = calls.find((c) => c.content.body.startsWith("Failed after"))
    expect(errorCall).toBeDefined()

    // Simulate a fresh manual run that loads these activities from Linear
    const activities: SessionPrompt[] = calls.map((c, i) => ({
      id: `activity-${i}`,
      type: "thought",
      content: { body: c.content.body },
      createdAt: new Date(Date.now() + i * 1000),
    }))

    // The error activity is detectable
    const hasError = activities.some(isErrorActivity)
    expect(hasError).toBe(true)

    // The timestamp is extractable for hold detection
    const errorTimestamp = findLastErrorTimestamp(activities)
    expect(errorTimestamp).not.toBeNull()

    // Without a follow-up, this issue remains held
    const followUp = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUp).toBeNull()
  })

  test("fresh invocation reconstructs error-held classification from activities alone", () => {
    // Simulate what a fresh `ralphly run` would see after a prior failure:
    // session activities contain an error marker with no subsequent prompt
    const issue = makeIssue({ id: "i1", identifier: "ENG-1", title: "Previously failed" })

    // Scenario 1: session status reflects error → error-held
    const work1 = makeWork(issue, { status: "error" })
    const ctx1 = buildClassificationContext([work1])
    const classified1 = classifyAll([work1], ctx1)
    expect(classified1[0]!.readiness).toBe("error-held")

    // Scenario 2: session status is "active" but activity-derived errorHeldIds
    // contains this issue (durable path) → error-held
    const work2 = makeWork(issue, { status: "active" })
    const ctx2 = buildClassificationContext([work2], undefined, new Set(["i1"]))
    const classified2 = classifyAll([work2], ctx2)
    expect(classified2[0]!.readiness).toBe("error-held")
  })

  test("error-held state persists until explicitly cleared by prompted follow-up", () => {
    const errorTime = new Date("2025-06-01T10:00:00Z")

    // Activities from a previous failed run
    const activitiesAfterFailure: SessionPrompt[] = [
      {
        id: "a-start",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): bun test exited with code 1" },
        createdAt: errorTime,
      },
    ]

    // Fresh run 1: no follow-up → still held
    const ts1 = findLastErrorTimestamp(activitiesAfterFailure)
    expect(ts1).toEqual(errorTime)
    expect(findPromptedFollowUp(activitiesAfterFailure, ts1!)).toBeNull()

    // Fresh run 2: still no follow-up (hours later) → still held
    // (the passage of time alone does not clear the hold)
    expect(findPromptedFollowUp(activitiesAfterFailure, ts1!)).toBeNull()

    // Fresh run 3: user sends a follow-up → hold clears
    const activitiesWithFollowUp: SessionPrompt[] = [
      ...activitiesAfterFailure,
      {
        id: "a-followup",
        type: "prompt",
        content: { body: "I fixed the dependency, please retry" },
        createdAt: new Date("2025-06-01T14:00:00Z"),
      },
    ]
    const ts3 = findLastErrorTimestamp(activitiesWithFollowUp)
    const followUp = findPromptedFollowUp(activitiesWithFollowUp, ts3!)
    expect(followUp).toBe("I fixed the dependency, please retry")
  })

  test("error summary is preserved in activities for retry feedback reconstruction", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a-start",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-check-fail",
        type: "thought",
        content: { body: "[attempt 1/2] Check failed — retrying\nbun test failed" },
        createdAt: new Date("2025-06-01T09:30:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): bun test exited with code 1" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
    ]

    const errorSummary = findLastErrorSummary(activities)
    expect(errorSummary).toBe("Failed after 2 attempt(s): bun test exited with code 1")

    // When a follow-up arrives, the worker builds combined feedback
    const followUpText = "I added the missing test fixture"
    const feedback = [errorSummary, `\nUser follow-up: ${followUpText}`].join("\n")
    expect(feedback).toContain("Failed after 2 attempt(s)")
    expect(feedback).toContain("I added the missing test fixture")
  })

  test("multiple error cycles: only the last unresolved error creates a hold", () => {
    const activities: SessionPrompt[] = [
      // First failure
      {
        id: "a1",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): first failure" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      // User cleared the first failure
      {
        id: "a2",
        type: "prompt",
        content: { body: "Fixed config, retry" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
      // Second failure (new run after retry)
      {
        id: "a3",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): second failure" },
        createdAt: new Date("2025-06-01T12:00:00Z"),
      },
    ]

    // The hold is based on the LAST error
    const lastErrorTime = findLastErrorTimestamp(activities)
    expect(lastErrorTime).toEqual(new Date("2025-06-01T12:00:00Z"))

    // The follow-up at 11:00 was before the second error → does NOT clear it
    const followUp = findPromptedFollowUp(activities, lastErrorTime!)
    expect(followUp).toBeNull()

    // The error summary is from the second failure
    const summary = findLastErrorSummary(activities)
    expect(summary).toContain("second failure")
  })
})

// ===========================================================================
// 4. SAME-SESSION RETRY AND SESSION-WRITE BEHAVIOR
//
// Proves that the session-write contract (start → [check_failed…] → success | error)
// is honored, and that same-session retry works through the documented
// activity-based follow-up mechanism.
// ===========================================================================

describe("acceptance: session-write contract and same-session retry", () => {
  test("successful run writes exactly: start → success", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Quick fix" }),
    )

    await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 1 },
        engineLayer: makeEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    const bodies = calls.map((c) => c.content.body)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain("Starting work on ENG-1")
    expect(bodies[1]).toContain("All checks passed")
  })

  test("failed run writes exactly: start → error (with durable hold marker)", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Will fail" }),
    )

    await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 1 },
        engineLayer: makeFailingEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    const bodies = calls.map((c) => c.content.body)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain("Starting work on ENG-1")
    expect(bodies[1]).toMatch(/^Failed after/)

    // Verify the error activity IS the durable hold marker
    const errorActivity: SessionPrompt = {
      id: "reconstructed",
      type: "thought",
      content: { body: bodies[1]! },
      createdAt: new Date(),
    }
    expect(isErrorActivity(errorActivity)).toBe(true)
  })

  test("retry run writes: start → check_failed → success", async () => {
    let callCount = 0
    const retryEngine = Layer.succeed(Engine, {
      execute: () => {
        callCount++
        if (callCount === 1) {
          return Effect.fail(
            new CheckFailure({ command: "bun test", stderr: "test failed", exitCode: 1 }),
          )
        }
        return Effect.succeed({ response: "Fixed!" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Flaky test" }),
    )

    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 2 },
        engineLayer: retryEngine,
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)

    const bodies = calls.map((c) => c.content.body)
    expect(bodies.length).toBe(3) // start + check_failed + success
    expect(bodies[0]).toContain("Starting work on ENG-1")
    expect(bodies[1]).toContain("Check failed")
    expect(bodies[2]).toContain("All checks passed")
  })

  test("exhausted retry run writes: start → check_failed → error", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Persistent failure" }),
    )

    const result = await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: { ...baseConfig, maxAttempts: 2 },
        engineLayer: makeFailingEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(false)

    const bodies = calls.map((c) => c.content.body)
    expect(bodies.length).toBe(3) // start + check_failed + error
    expect(bodies[0]).toContain("Starting work on ENG-1")
    expect(bodies[1]).toContain("Check failed")
    expect(bodies[2]).toMatch(/^Failed after/)
  })

  test("all activities target the correct session ID", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Task" }),
      { id: "session-xyz" },
    )

    await Effect.runPromise(
      runIssue({
        work,
        workspace: "/tmp/test-workspace",
        config: baseConfig,
        engineLayer: makeEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    // Every activity write targets the same session
    for (const call of calls) {
      expect(call.agentSessionId).toBe("session-xyz")
    }
  })

  test("same-session retry flow: error → follow-up → retry with combined feedback", () => {
    // This tests the full data flow that the worker uses for retry
    const activities: SessionPrompt[] = [
      {
        id: "a-start",
        type: "thought",
        content: { body: formatStartActivity("ENG-1") },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: formatErrorActivity("bun test exited with code 1", 2) },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      {
        id: "a-followup",
        type: "prompt",
        content: { body: "I added the missing dependency, try again" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]

    // Step 1: Detect error
    const errorTimestamp = findLastErrorTimestamp(activities)
    expect(errorTimestamp).not.toBeNull()

    // Step 2: Detect follow-up
    const followUpText = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUpText).toBe("I added the missing dependency, try again")

    // Step 3: Build retry feedback (as the worker would)
    const errorSummary = findLastErrorSummary(activities)!
    const feedback = [errorSummary, `\nUser follow-up: ${followUpText}`].join("\n")

    // Step 4: Build task input with retry feedback
    const work = makeWork(
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Fix the thing" }),
    )
    const taskInput = buildTaskInput(work, feedback)

    // Verify the task input includes both the issue context and retry feedback
    expect(taskInput).toContain("Fix the thing")
    expect(taskInput).toContain("Previous Attempt Feedback")
    expect(taskInput).toContain("Failed after 2 attempt(s)")
    expect(taskInput).toContain("I added the missing dependency")
  })

  test("activity format round-trips through write → detect → classify", () => {
    // Verify the format written by the runner is correctly detected by the classifier

    // Format an error activity as the runner would
    const errorBody = formatErrorActivity("npm test failed", 3)
    expect(errorBody).toBe("Failed after 3 attempt(s): npm test failed")

    // Reconstruct as a session prompt (as loaded from Linear)
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: errorBody },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }

    // Verify detection
    expect(isErrorActivity(activity)).toBe(true)
    expect(findLastErrorTimestamp([activity])).toEqual(activity.createdAt)
    expect(findLastErrorSummary([activity])).toBe(errorBody)

    // Format a success activity — should NOT be detected as error
    const successBody = formatSuccessActivity(2, 3)
    const successActivity: SessionPrompt = {
      id: "a2",
      type: "thought",
      content: { body: successBody },
      createdAt: new Date("2025-06-01T11:00:00Z"),
    }
    expect(isErrorActivity(successActivity)).toBe(false)

    // Format a start activity — should NOT be detected as error
    const startBody = formatStartActivity("ENG-1")
    const startActivity: SessionPrompt = {
      id: "a3",
      type: "thought",
      content: { body: startBody },
      createdAt: new Date("2025-06-01T08:00:00Z"),
    }
    expect(isErrorActivity(startActivity)).toBe(false)
  })

  test("mapLoopEventToActivity only maps check_failed (intermediate events)", () => {
    // attempt_start → no activity (internal bookkeeping)
    expect(
      mapLoopEventToActivity({ type: "attempt_start", attempt: 1, maxAttempts: 2 }),
    ).toBeNull()

    // check_failed → activity with feedback
    const checkFailed = mapLoopEventToActivity({
      type: "check_failed",
      attempt: 1,
      maxAttempts: 2,
      feedback: "lint errors found",
    })
    expect(checkFailed).not.toBeNull()
    expect(checkFailed!.kind).toBe("check_failed")
    expect(checkFailed!.body).toContain("Check failed")
    expect(checkFailed!.body).toContain("lint errors found")

    // success → no activity (runner writes this explicitly)
    expect(
      mapLoopEventToActivity({ type: "success", attempt: 1, maxAttempts: 2 }),
    ).toBeNull()
  })
})

// ===========================================================================
// 5. MANUAL BACKLOG DRAINING
//
// Proves the worker loop processes actionable work and stops only when
// no actionable issues remain, continuing past per-issue failures.
// Uses the pure selection and classification layer to simulate the
// backlog-draining behavior without requiring the full Effect worker.
// ===========================================================================

describe("acceptance: manual backlog draining", () => {
  test("backlog draining processes all actionable items and skips non-actionable", () => {
    // Simulate a backlog drain using the selection API
    const actionable1 = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Task 1",
      priority: 2,
      createdAt: new Date("2025-01-01"),
    })
    const actionable2 = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Task 2",
      priority: 3,
      createdAt: new Date("2025-02-01"),
    })
    const blocked = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Blocked",
      inverseRelations: [
        { issueId: "i-unknown-blocker", relatedIssueId: "i3", type: "blocks" },
      ],
    })
    const terminal = makeIssue({
      id: "i4", identifier: "ENG-4", title: "Done",
      completedAt: new Date("2025-06-01"),
      state: { id: "s1", name: "Done", type: "completed" },
    })

    const allCandidates: CandidateWork[] = [
      makeWork(actionable1),
      makeWork(actionable2),
      makeWork(blocked),
      makeWork(terminal),
    ]

    // Simulate the drain loop: select next, "process" it, remove, repeat
    const processed: string[] = []
    let remaining = [...allCandidates]

    for (let iteration = 0; iteration < 10; iteration++) {
      const selection = selectNext(remaining)
      if (!selection.next) break
      processed.push(selection.next.issue.identifier)
      // Remove from remaining (simulating in-flight tracking)
      remaining = remaining.filter(
        (c) => c.issue.id !== selection.next!.issue.id,
      )
    }

    // Only actionable items were processed, in priority order
    expect(processed).toEqual(["ENG-1", "ENG-2"])
  })

  test("backlog draining continues past per-issue failures", async () => {
    // Simulate processing 3 actionable issues where one fails
    const issues = [
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Will succeed", priority: 1 }),
      makeIssue({ id: "i2", identifier: "ENG-2", title: "Will fail", priority: 2 }),
      makeIssue({ id: "i3", identifier: "ENG-3", title: "Will succeed", priority: 3 }),
    ]

    let engineCallCount = 0
    const mixedEngine = Layer.succeed(Engine, {
      execute: () => {
        engineCallCount++
        // Second issue fails
        if (engineCallCount === 2) {
          return Effect.fail(
            new CheckFailure({ command: "bun test", stderr: "assertion error", exitCode: 1 }),
          )
        }
        return Effect.succeed({ response: "Done" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const results: Array<{ id: string; success: boolean }> = []

    // Process each issue through runIssue
    for (const issue of issues) {
      const work = makeWork(issue)
      const result = await Effect.runPromise(
        runIssue({
          work,
          workspace: "/tmp/test-workspace",
          config: { ...baseConfig, maxAttempts: 1 },
          engineLayer: mixedEngine,
        }).pipe(Effect.provide(linearLayer)),
      )
      results.push({ id: issue.identifier, success: result.success })
    }

    // First and third succeed, second fails
    expect(results[0]).toEqual({ id: "ENG-1", success: true })
    expect(results[1]).toEqual({ id: "ENG-2", success: false })
    expect(results[2]).toEqual({ id: "ENG-3", success: true })

    // All 3 issues got start activities
    const startActivities = calls.filter((c) => c.content.body.includes("Starting work"))
    expect(startActivities).toHaveLength(3)
  })

  test("draining stops when only non-actionable work remains", () => {
    // Start with a mix, drain actionable items
    const actionable = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Actionable",
    })
    const blocked = makeIssue({
      id: "i2", identifier: "ENG-2", title: "Blocked",
      inverseRelations: [
        { issueId: "i-unknown", relatedIssueId: "i2", type: "blocks" },
      ],
    })
    const errorHeld = makeIssue({
      id: "i3", identifier: "ENG-3", title: "Error held",
    })
    const backlog = makeIssue({
      id: "i4", identifier: "ENG-4", title: "In backlog",
      state: { id: "s1", name: "Backlog", type: "backlog" },
    })

    const allCandidates: CandidateWork[] = [
      makeWork(actionable),
      makeWork(blocked),
      makeWork(errorHeld, { status: "error" }),
      makeWork(backlog),
    ]

    // First selection: actionable item
    const sel1 = selectNext(allCandidates)
    expect(sel1.next!.issue.identifier).toBe("ENG-1")

    // After processing ENG-1, remove it from pool
    const remaining = allCandidates.filter((c) => c.issue.id !== "i1")

    // Second selection: no actionable work remains
    const sel2 = selectNext(remaining)
    expect(sel2.next).toBeNull()
    expect(sel2.summary.actionable).toBe(0)
    expect(sel2.summary.blocked).toBe(1)
    expect(sel2.summary.errorHeld).toBe(1)
    expect(sel2.summary.ineligible).toBe(1)
  })

  test("draining with an error-held retry: error-held issue becomes actionable after follow-up", () => {
    // Simulates the scenario where an issue fails, gets error-held,
    // then a follow-up arrives making it retryable

    const errorTime = new Date("2025-06-01T10:00:00Z")
    const issue = makeIssue({
      id: "i1", identifier: "ENG-1", title: "Previously failed",
    })

    // Before follow-up: error-held
    const activitiesBeforeFollowUp: SessionPrompt[] = [
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): bun test failed" },
        createdAt: errorTime,
      },
    ]

    const errorTs = findLastErrorTimestamp(activitiesBeforeFollowUp)
    expect(errorTs).not.toBeNull()
    expect(findPromptedFollowUp(activitiesBeforeFollowUp, errorTs!)).toBeNull()

    // Classify as error-held
    const candidates1 = [makeWork(issue, { status: "error" })]
    const sel1 = selectNext(candidates1)
    expect(sel1.next).toBeNull()
    expect(sel1.summary.errorHeld).toBe(1)

    // After follow-up: retryable (not error-held in the next classification
    // because the worker would detect the follow-up and process as retry)
    const activitiesAfterFollowUp: SessionPrompt[] = [
      ...activitiesBeforeFollowUp,
      {
        id: "a-followup",
        type: "prompt",
        content: { body: "Fixed the issue, retry please" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]

    const errorTs2 = findLastErrorTimestamp(activitiesAfterFollowUp)
    const followUp = findPromptedFollowUp(activitiesAfterFollowUp, errorTs2!)
    expect(followUp).toBe("Fixed the issue, retry please")

    // Worker would build retry feedback and process the issue
    const errorSummary = findLastErrorSummary(activitiesAfterFollowUp)!
    const retryFeedback = [errorSummary, `\nUser follow-up: ${followUp}`].join("\n")
    expect(retryFeedback).toContain("Failed after 2 attempt(s)")
    expect(retryFeedback).toContain("Fixed the issue, retry please")
  })

  test("backlog summary provides operator-visible explanation of drain state", () => {
    const issues = [
      makeIssue({ id: "i1", identifier: "ENG-1", title: "Ready to go", priority: 2 }),
      makeIssue({
        id: "i2", identifier: "ENG-2", title: "Blocked by ENG-10",
        inverseRelations: [
          { issueId: "i-blocker", relatedIssueId: "i2", type: "blocks" },
        ],
      }),
      makeIssue({
        id: "i3", identifier: "ENG-3", title: "Failed earlier",
      }),
      makeIssue({
        id: "i4", identifier: "ENG-4", title: "In backlog",
        state: { id: "s1", name: "Backlog", type: "backlog" },
      }),
      makeIssue({
        id: "i5", identifier: "ENG-5", title: "Already completed",
        completedAt: new Date("2025-06-01"),
        state: { id: "s2", name: "Done", type: "completed" },
      }),
    ]

    const candidates: CandidateWork[] = [
      makeWork(issues[0]!),
      makeWork(issues[1]!),
      makeWork(issues[2]!, { status: "error" }),
      makeWork(issues[3]!),
      makeWork(issues[4]!),
    ]
    const ctx = buildClassificationContext(
      candidates,
      [makeIssue({ id: "i-blocker", identifier: "ENG-10", title: "Blocker" })],
    )
    const selection = selectNext(candidates, ctx)
    const summary = formatBacklogSummary(selection)

    // Summary should be operator-readable
    expect(summary).toContain("5 total")
    expect(summary).toContain("1 actionable")
    expect(summary).toContain("1 blocked")
    expect(summary).toContain("1 error-held")
    expect(summary).toContain("1 ineligible")
    expect(summary).toContain("1 terminal")
    expect(summary).toContain("ENG-1") // next item
    expect(summary).toContain("skip ENG-2") // blocked
    expect(summary).toContain("skip ENG-3") // error-held
    expect(summary).toContain("skip ENG-4") // ineligible
    expect(summary).toContain("skip ENG-5") // terminal
  })
})
