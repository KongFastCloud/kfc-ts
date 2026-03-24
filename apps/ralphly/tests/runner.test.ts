/**
 * ABOUTME: Tests for the issue runner that invokes blueprints for a single
 * Linear issue/session. Verifies the explicit session-write contract:
 *   start → [check_failed…] → success | error
 *
 * The runner is the single owner of all session-write decisions.
 * Terminal writes (success + error) are explicit — not through onEvent.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, CheckFailure, type AgentResult } from "@workspace/blueprints"
import { Linear } from "../src/linear/client.js"
import { runIssue, buildTaskInput } from "../src/runner.js"
import type { CandidateWork, LinearIssueData, LinearSessionData } from "../src/linear/types.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal LinearIssueData for testing. */
const makeIssue = (overrides?: Partial<LinearIssueData>): LinearIssueData => ({
  id: "issue-1",
  identifier: "ENG-42",
  title: "Fix the widget",
  description: "The widget is broken and needs fixing.",
  url: "https://linear.app/issue/ENG-42",
  priority: 3,
  priorityLabel: "Normal",
  estimate: null,
  branchName: "eng-42-fix-the-widget",
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

/** Build a minimal LinearSessionData for testing. */
const makeSession = (overrides?: Partial<LinearSessionData>): LinearSessionData => ({
  id: "session-1",
  status: "active",
  appUserId: "agent-001",
  issueId: "issue-1",
  creatorId: "user-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

/** Build a CandidateWork from issue and session. */
const makeWork = (
  issueOverrides?: Partial<LinearIssueData>,
  sessionOverrides?: Partial<LinearSessionData>,
): CandidateWork => ({
  issue: makeIssue(issueOverrides),
  session: makeSession(sessionOverrides),
})

/** Create a mock Engine layer that returns a fixed result. */
const makeEngineLayer = (
  response = "Done!",
  resumeToken?: string,
): Layer.Layer<Engine> =>
  Layer.succeed(Engine, {
    execute: (_prompt: string, _workDir: string) =>
      Effect.succeed({ response, resumeToken } satisfies AgentResult),
  })

/** Create a mock Engine layer that fails with a check failure. */
const makeFailingEngineLayer = (): Layer.Layer<Engine> =>
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

/** Tracking mock for Linear activity writes. */
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

// ---------------------------------------------------------------------------
// buildTaskInput tests
// ---------------------------------------------------------------------------

describe("buildTaskInput", () => {
  test("builds prompt from issue title and description", () => {
    const work = makeWork()
    const input = buildTaskInput(work)

    expect(input).toContain("Fix the widget")
    expect(input).toContain("The widget is broken and needs fixing.")
  })

  test("handles issue with no description", () => {
    const work = makeWork({ description: null })
    const input = buildTaskInput(work)

    expect(input).toContain("Fix the widget")
    expect(input).not.toContain("## Description")
  })

  test("appends retry feedback when provided", () => {
    const work = makeWork()
    const input = buildTaskInput(work, "npm test failed: 3 tests broken")

    expect(input).toContain("Fix the widget")
    expect(input).toContain("## Previous Attempt Feedback")
    expect(input).toContain("npm test failed: 3 tests broken")
  })

  test("does not include feedback section when no feedback", () => {
    const work = makeWork()
    const input = buildTaskInput(work)

    expect(input).not.toContain("Previous Attempt Feedback")
  })

  test("does not include feedback section for undefined feedback", () => {
    const work = makeWork()
    const input = buildTaskInput(work, undefined)

    expect(input).not.toContain("Previous Attempt Feedback")
  })
})

// ---------------------------------------------------------------------------
// runIssue tests — session write contract: start → success | error
// ---------------------------------------------------------------------------

describe("runIssue", () => {
  test("writes start activity when processing begins", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork()

    await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer: makeEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    // First call should be the start activity
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]!.agentSessionId).toBe("session-1")
    expect(calls[0]!.content.body).toContain("Starting work on ENG-42")
  })

  test("writes explicit success activity when run completes", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork()

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer: makeEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.issueIdentifier).toBe("ENG-42")
    expect(result.sessionId).toBe("session-1")
    expect(result.attempts).toBe(1)

    // Should have exactly: start + success activities
    const bodies = calls.map((c) => c.content.body)
    expect(bodies.some((b) => b.includes("Starting work on ENG-42"))).toBe(true)
    expect(bodies.some((b) => b.includes("All checks passed"))).toBe(true)
    // The success activity should be written by the runner, not doubled
    const successCount = bodies.filter((b) => b.includes("All checks passed")).length
    expect(successCount).toBe(1)
  })

  test("writes explicit error activity when run fails terminally", async () => {
    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork()

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer: makeFailingEngineLayer(),
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()

    // Should have exactly: start + error activities
    const bodies = calls.map((c) => c.content.body)
    expect(bodies.some((b) => b.includes("Starting work on ENG-42"))).toBe(true)
    expect(bodies.some((b) => b.includes("Failed after"))).toBe(true)
  })

  test("complete lifecycle: start → check_failed → success on retry", async () => {
    // Engine that fails first call, succeeds second
    let callCount = 0
    const retryEngine = Layer.succeed(Engine, {
      execute: (_prompt: string, _workDir: string) => {
        callCount++
        if (callCount === 1) {
          return Effect.fail(
            new CheckFailure({
              command: "npm test",
              stderr: "Tests failed",
              exitCode: 1,
            }),
          )
        }
        return Effect.succeed({ response: "Fixed!" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer, calls } = makeMockLinearLayer()
    const work = makeWork()

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 2, checks: [], gitMode: "none", report: "none" },
        engineLayer: retryEngine,
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)

    // Activities should be: start → check_failed → success
    const bodies = calls.map((c) => c.content.body)
    expect(bodies[0]).toContain("Starting work on ENG-42")
    expect(bodies.some((b) => b.includes("Check failed"))).toBe(true)
    expect(bodies[bodies.length - 1]).toContain("All checks passed")
  })

  test("returns resume token from agent execution", async () => {
    const { layer: linearLayer } = makeMockLinearLayer()
    const work = makeWork()

    const result = await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer: makeEngineLayer("Done!", "resume-token-abc"),
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(result.success).toBe(true)
    expect(result.resumeToken).toBe("resume-token-abc")
  })

  test("includes retry feedback in task input when provided", async () => {
    // We can verify this indirectly: the agent receives the feedback in its prompt.
    // We'll track what the engine receives.
    let receivedPrompt = ""

    const engineLayer = Layer.succeed(Engine, {
      execute: (prompt: string, _workDir: string) => {
        receivedPrompt = prompt
        return Effect.succeed({ response: "Fixed!" } satisfies AgentResult)
      },
    })

    const { layer: linearLayer } = makeMockLinearLayer()
    const work = makeWork()

    await Effect.runPromise(
      runIssue({
        work,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
        retryFeedback: "Previous attempt failed: tests broken",
      }).pipe(Effect.provide(linearLayer)),
    )

    expect(receivedPrompt).toContain("Fix the widget")
    expect(receivedPrompt).toContain("Previous Attempt Feedback")
    expect(receivedPrompt).toContain("Previous attempt failed: tests broken")
  })
})
