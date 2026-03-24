/**
 * ABOUTME: Unit tests for the BeadsRunObserver and buildWatchRequest factory.
 * Verifies that the observer writes metadata and comments at the correct
 * lifecycle points, and that the request factory assembles prompts correctly.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { BeadsMetadata, BeadsIssue } from "../src/beads.js"
import type { RunRequest } from "../src/RunRequest.js"
import type { TaskResult } from "../src/TaskResult.js"
import type { AgentResult } from "../src/engine/Engine.js"
import { makeBeadsRunObserver, buildWatchRequest, type BeadsObserverDeps } from "../src/BeadsRunObserver.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let calls: Array<{ op: string; id: string; text?: string; metadata?: BeadsMetadata }> = []

function makeTestDeps(): BeadsObserverDeps {
  return {
    writeMetadata: (id, metadata) => {
      calls.push({ op: "writeMetadata", id, metadata })
      return Effect.succeed(undefined)
    },
    addComment: (id, text) => {
      calls.push({ op: "addComment", id, text })
      return Effect.succeed(undefined)
    },
  }
}

const baseRequest: RunRequest = {
  task: "implement feature",
  engine: "claude",
  checks: [],
  maxAttempts: 2,
  gitMode: "none",
  reportMode: "none",
}

beforeEach(() => {
  calls = []
})

// ===========================================================================
// makeBeadsRunObserver
// ===========================================================================

describe("makeBeadsRunObserver", () => {
  test("onStart writes metadata with engine, workerId, and startedAt", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-1", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(observer.onStart(baseRequest))

    expect(calls.length).toBe(1)
    expect(calls[0]!.op).toBe("writeMetadata")
    expect(calls[0]!.id).toBe("obs-1")
    expect(calls[0]!.metadata?.engine).toBe("claude")
    expect(calls[0]!.metadata?.workerId).toBe("w-1")
    expect(calls[0]!.metadata?.startedAt).toBeTruthy()
    expect(calls[0]!.metadata?.finishedAt).toBeUndefined()
  })

  test("onAgentResult writes session comment with resume token", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-2", workerId: "w-2" },
      makeTestDeps(),
    )

    // Must call onStart first to capture engine
    await Effect.runPromise(observer.onStart(baseRequest))
    calls = [] // reset

    const agentResult: AgentResult = { response: "done", resumeToken: "tok-abc" }
    await Effect.runPromise(observer.onAgentResult(agentResult, 1, 2))

    expect(calls.length).toBe(1)
    expect(calls[0]!.op).toBe("addComment")
    expect(calls[0]!.id).toBe("obs-2")
    expect(calls[0]!.text).toContain("tok-abc")
    expect(calls[0]!.text).toContain("claude --resume")
  })

  test("onAgentResult with codex engine uses codex resume format", async () => {
    const codexRequest: RunRequest = { ...baseRequest, engine: "codex" }
    const observer = makeBeadsRunObserver(
      { issueId: "obs-codex", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(observer.onStart(codexRequest))
    calls = []

    await Effect.runPromise(
      observer.onAgentResult({ response: "done", resumeToken: "tok-codex" }, 1, 1),
    )

    expect(calls[0]!.text).toContain("codex resume tok-codex")
  })

  test("onLoopEvent check_failed writes check failure comment", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-3", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(
      observer.onLoopEvent({
        type: "check_failed",
        attempt: 1,
        maxAttempts: 3,
        feedback: "lint error on line 42",
      }),
    )

    expect(calls.length).toBe(1)
    expect(calls[0]!.text).toContain("check failed")
    expect(calls[0]!.text).toContain("lint error on line 42")
    expect(calls[0]!.text).toContain("[attempt 1/3]")
  })

  test("onLoopEvent success writes success comment", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-4", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(
      observer.onLoopEvent({
        type: "success",
        attempt: 2,
        maxAttempts: 3,
      }),
    )

    expect(calls.length).toBe(1)
    expect(calls[0]!.text).toContain("all checks passed")
    expect(calls[0]!.text).toContain("[attempt 2/3]")
  })

  test("onLoopEvent attempt_start does not write", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-5", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(
      observer.onLoopEvent({
        type: "attempt_start",
        attempt: 1,
        maxAttempts: 2,
      }),
    )

    expect(calls.length).toBe(0)
  })

  test("onComplete writes final metadata with timing", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-6", workerId: "w-1" },
      makeTestDeps(),
    )

    // Must call onStart to capture startedAt
    await Effect.runPromise(observer.onStart(baseRequest))
    const startMeta = calls[0]!.metadata!
    calls = []

    const result: TaskResult = {
      success: true,
      engine: "claude",
      resumeToken: "tok-final",
    }
    await Effect.runPromise(observer.onComplete(result))

    expect(calls.length).toBe(1)
    expect(calls[0]!.op).toBe("writeMetadata")
    expect(calls[0]!.metadata?.engine).toBe("claude")
    expect(calls[0]!.metadata?.resumeToken).toBe("tok-final")
    expect(calls[0]!.metadata?.workerId).toBe("w-1")
    expect(calls[0]!.metadata?.startedAt).toBe(startMeta.startedAt)
    expect(calls[0]!.metadata?.finishedAt).toBeTruthy()
  })

  test("onComplete on failure still writes final metadata", async () => {
    const observer = makeBeadsRunObserver(
      { issueId: "obs-7", workerId: "w-1" },
      makeTestDeps(),
    )

    await Effect.runPromise(observer.onStart(baseRequest))
    calls = []

    const result: TaskResult = {
      success: false,
      engine: "claude",
      error: "all retries exhausted",
    }
    await Effect.runPromise(observer.onComplete(result))

    // Observer writes final metadata even on failure
    expect(calls.length).toBe(1)
    expect(calls[0]!.op).toBe("writeMetadata")
    expect(calls[0]!.metadata?.finishedAt).toBeTruthy()
  })
})

// ===========================================================================
// buildWatchRequest
// ===========================================================================

describe("buildWatchRequest", () => {
  const issue: BeadsIssue = {
    id: "req-1",
    title: "Add user auth",
    description: "Implement OAuth2 flow",
    design: "Use PKCE for SPAs",
    acceptance_criteria: "Login works with Google",
    notes: "Check rate limits",
  }

  const config = {
    engine: "claude" as const,
    checks: ["npm test", "npm run lint"],
    maxAttempts: 3,
    report: "basic" as const,
    git: { mode: "commit" as const },
  }

  test("assembles RunRequest from issue + config", () => {
    const request = buildWatchRequest(issue, config)

    expect(request.engine).toBe("claude")
    expect(request.checks).toEqual(["npm test", "npm run lint"])
    expect(request.maxAttempts).toBe(3)
    expect(request.gitMode).toBe("commit")
    expect(request.reportMode).toBe("basic")
    expect(request.task).toContain("Add user auth")
  })

  test("includes issue description in task prompt", () => {
    const request = buildWatchRequest(issue, config)
    expect(request.task).toContain("Implement OAuth2 flow")
  })

  test("appends previous error when provided", () => {
    const request = buildWatchRequest(issue, config, "TypeError: undefined is not a function")

    expect(request.task).toContain("## Previous Error")
    expect(request.task).toContain("TypeError: undefined is not a function")
  })

  test("does not include previous error section when no error", () => {
    const request = buildWatchRequest(issue, config)
    expect(request.task).not.toContain("## Previous Error")
  })

  test("does not include previous error section when error is undefined", () => {
    const request = buildWatchRequest(issue, config, undefined)
    expect(request.task).not.toContain("## Previous Error")
  })

  test("accepts custom buildPromptFromIssue", () => {
    const customBuilder = (i: BeadsIssue) => `CUSTOM: ${i.title}`
    const request = buildWatchRequest(issue, config, undefined, customBuilder)

    expect(request.task).toBe("CUSTOM: Add user auth")
  })

  test("is pure data with no functions or Effect types", () => {
    const request = buildWatchRequest(issue, config)
    const keys = Object.keys(request)
    for (const key of keys) {
      const value = (request as unknown as Record<string, unknown>)[key]
      expect(typeof value).not.toBe("function")
    }
  })
})
