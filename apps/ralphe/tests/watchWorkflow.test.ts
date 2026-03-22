/**
 * ABOUTME: Tests for the shared watch-task workflow (processClaimedTask + pollClaimAndProcess).
 * Verifies the canonical task lifecycle without relying on headless or TUI-specific orchestration.
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test"
import { Effect } from "effect"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { TaskResult } from "../src/runTask.js"
import type { ProcessTaskResult, PollResult } from "../src/watchWorkflow.js"

// ---------------------------------------------------------------------------
// Configurable stubs
// ---------------------------------------------------------------------------

let readyQueue: BeadsIssue[] = []
let claimResults: Map<string, boolean> = new Map()
let taskResult: TaskResult = {
  success: true,
  engine: "claude",
  resumeToken: "tok-test",
}

// Track all calls to beads operations in order
let calls: Array<{
  op: string
  id?: string
  reason?: string
  metadata?: BeadsMetadata
}> = []

// Track runTask invocations
let runTaskCalls: Array<{ prompt: string; issueId?: string }> = []

// Configurable previous metadata returned by readMetadata
let previousMetadata: BeadsMetadata | undefined = undefined

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

let processClaimedTask: typeof import("../src/watchWorkflow.js").processClaimedTask
let pollClaimAndProcess: typeof import("../src/watchWorkflow.js").pollClaimAndProcess

beforeAll(async () => {
  mock.module("../src/beadsAdapter.js", () => ({
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        return [...readyQueue]
      })()),
  }))

  mock.module("../src/beads.js", () => ({
    readMetadata: (id: string) => {
      calls.push({ op: "readMetadata", id })
      return Effect.succeed(previousMetadata)
    },

    claimTask: (id: string) =>
      Effect.succeed((() => {
        calls.push({ op: "claimTask", id })
        return claimResults.get(id) ?? true
      })()),

    closeTaskSuccess: (id: string, reason?: string) => {
      calls.push({ op: "closeTaskSuccess", id, reason })
      return Effect.succeed(undefined)
    },

    markTaskExhaustedFailure: (id: string, reason: string, metadata: BeadsMetadata) => {
      calls.push({ op: "markTaskExhaustedFailure", id, reason, metadata })
      return Effect.succeed(undefined)
    },

    writeMetadata: (id: string, metadata: BeadsMetadata) => {
      calls.push({ op: "writeMetadata", id, metadata })
      return Effect.succeed(undefined)
    },

    recoverStaleTasks: (_workerId: string) => {
      calls.push({ op: "recoverStaleTasks" })
      return Effect.succeed(0)
    },

    buildPromptFromIssue: (issue: BeadsIssue) => {
      const sections: string[] = [issue.title]
      if (issue.description) sections.push(`\n## Description\n${issue.description}`)
      return sections.join("\n")
    },

    addComment: () => Effect.succeed(undefined),
  }))

  mock.module("../src/runTask.js", () => ({
    runTask: (prompt: string, _config: unknown, opts?: { issueId?: string }) => {
      runTaskCalls.push({ prompt, issueId: opts?.issueId })
      return Effect.succeed(taskResult)
    },
  }))

  mock.module("../src/config.js", () => ({
    loadConfig: () => ({
      engine: "claude" as const,
      checks: [],
      report: "none",
      maxAttempts: 1,
      git: { mode: "none" as const },
    }),
  }))

  // @ts-expect-error Bun test isolation import suffix is runtime-only.
  ;({ processClaimedTask, pollClaimAndProcess } = await import("../src/watchWorkflow.js?test") as typeof import("../src/watchWorkflow.js"))
})

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  readyQueue = []
  claimResults = new Map()
  taskResult = { success: true, engine: "claude", resumeToken: "tok-test" }
  previousMetadata = undefined
  calls = []
  runTaskCalls = []
})

afterAll(() => {
  mock.restore()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}` }
}

// ===========================================================================
// processClaimedTask
// ===========================================================================

describe("processClaimedTask: success lifecycle", () => {
  test("successful task reads metadata, writes start/final, and closes", async () => {
    const issue = makeIssue("wf-1", "Implement feature X")
    taskResult = { success: true, engine: "claude", resumeToken: "tok-abc" }

    const result = await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(result.success).toBe(true)
    expect(result.taskId).toBe("wf-1")
    expect(result.engine).toBe("claude")
    expect(result.resumeToken).toBe("tok-abc")

    // Verify operation ordering
    const ops = calls.map((c) => c.op)
    expect(ops).toEqual([
      "readMetadata",
      "writeMetadata",    // start metadata
      "writeMetadata",    // final metadata
      "closeTaskSuccess",
    ])

    // Verify start metadata
    const startMeta = calls[1]!.metadata!
    expect(startMeta.workerId).toBe("worker-1")
    expect(startMeta.engine).toBe("claude")
    expect(startMeta.startedAt).toBeTruthy()
    expect(startMeta.finishedAt).toBeUndefined()

    // Verify final metadata
    const finalMeta = calls[2]!.metadata!
    expect(finalMeta.resumeToken).toBe("tok-abc")
    expect(finalMeta.workerId).toBe("worker-1")
    expect(finalMeta.startedAt).toBeTruthy()
    expect(finalMeta.finishedAt).toBeTruthy()
    expect(finalMeta.startedAt).toBe(startMeta.startedAt)
  })

  test("runTask receives issueId for session comment writing", async () => {
    const issue = makeIssue("wf-issue-id", "Test issue ID")
    taskResult = { success: true, engine: "claude" }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(runTaskCalls.length).toBe(1)
    expect(runTaskCalls[0]!.issueId).toBe("wf-issue-id")
  })
})

describe("processClaimedTask: failure lifecycle", () => {
  test("failed task is marked as exhausted failure", async () => {
    const issue = makeIssue("wf-fail-1")
    taskResult = { success: false, engine: "claude", error: "checks failed" }

    const result = await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(result.success).toBe(false)
    expect(result.taskId).toBe("wf-fail-1")
    expect(result.error).toBe("checks failed")

    // Verify exhausted failure was called
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("wf-fail-1")
    expect(exhaustedCall?.reason).toContain("checks failed")
    expect(exhaustedCall?.metadata?.workerId).toBe("worker-1")
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()

    // Should NOT have closeTaskSuccess
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
  })

  test("failure with no error message uses default reason", async () => {
    const issue = makeIssue("wf-fail-default")
    taskResult = { success: false, engine: "claude" }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.reason).toContain("execution failed")
  })
})

describe("processClaimedTask: previous error propagation", () => {
  test("previous error is included in prompt", async () => {
    const issue = makeIssue("wf-retry", "Fix broken tests")
    taskResult = { success: true, engine: "claude" }
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
      error: "TypeError: Cannot read property 'map' of undefined",
    }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(runTaskCalls.length).toBe(1)
    expect(runTaskCalls[0]!.prompt).toContain("## Previous Error")
    expect(runTaskCalls[0]!.prompt).toContain("TypeError: Cannot read property 'map' of undefined")
  })

  test("fresh task has no previous error in prompt", async () => {
    const issue = makeIssue("wf-fresh", "New feature")
    taskResult = { success: true, engine: "claude" }
    previousMetadata = undefined

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(runTaskCalls[0]!.prompt).not.toContain("## Previous Error")
  })

  test("metadata without error does not add previous error section", async () => {
    const issue = makeIssue("wf-no-err", "Previously succeeded")
    taskResult = { success: true, engine: "claude" }
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
    }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    expect(runTaskCalls[0]!.prompt).not.toContain("## Previous Error")
  })

  test("readMetadata is called before writeMetadata", async () => {
    const issue = makeIssue("wf-order", "Check ordering")
    taskResult = { success: true, engine: "claude" }
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
      error: "previous failure",
    }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1"),
    )

    const readIdx = calls.findIndex((c) => c.op === "readMetadata")
    const writeIdx = calls.findIndex((c) => c.op === "writeMetadata")
    expect(readIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThan(readIdx)
  })
})

describe("processClaimedTask: metadata timing", () => {
  test("start metadata has startedAt but no finishedAt", async () => {
    const issue = makeIssue("wf-timing-1")
    taskResult = { success: true, engine: "claude", resumeToken: "tok" }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "test-timing"),
    )

    const metaCalls = calls.filter((c) => c.op === "writeMetadata")
    expect(metaCalls.length).toBe(2)

    const startMeta = metaCalls[0]!.metadata!
    expect(startMeta.startedAt).toBeTruthy()
    expect(startMeta.finishedAt).toBeUndefined()

    const finalMeta = metaCalls[1]!.metadata!
    expect(finalMeta.startedAt).toBeTruthy()
    expect(finalMeta.finishedAt).toBeTruthy()
    expect(finalMeta.startedAt).toBe(startMeta.startedAt)
  })

  test("exhausted failure metadata carries timing fields", async () => {
    const issue = makeIssue("wf-timing-fail")
    taskResult = { success: false, engine: "codex", error: "lint failed" }

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "codex",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "meta-worker"),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.metadata?.engine).toBe("codex")
    expect(exhaustedCall?.metadata?.workerId).toBe("meta-worker")
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
  })
})

// ===========================================================================
// pollClaimAndProcess
// ===========================================================================

describe("pollClaimAndProcess: poll outcomes", () => {
  test("returns NoneReady when queue is empty", async () => {
    readyQueue = []

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    expect(result._tag).toBe("NoneReady")
    expect(calls.some((c) => c.op === "queryQueued")).toBe(true)
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
  })

  test("returns ClaimContention when another worker claimed the task", async () => {
    readyQueue = [makeIssue("poll-contend")]
    claimResults.set("poll-contend", false)

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    expect(result._tag).toBe("ClaimContention")
    if (result._tag === "ClaimContention") {
      expect(result.taskId).toBe("poll-contend")
    }
    expect(runTaskCalls.length).toBe(0)
  })

  test("returns Processed with success for claimed and completed task", async () => {
    readyQueue = [makeIssue("poll-ok", "Feature X")]
    claimResults.set("poll-ok", true)
    taskResult = { success: true, engine: "claude", resumeToken: "tok-123" }

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    expect(result._tag).toBe("Processed")
    if (result._tag === "Processed") {
      expect(result.result.success).toBe(true)
      expect(result.result.taskId).toBe("poll-ok")
      expect(result.result.resumeToken).toBe("tok-123")
    }

    // Full lifecycle should have been executed
    const ops = calls.map((c) => c.op)
    expect(ops).toContain("queryQueued")
    expect(ops).toContain("claimTask")
    expect(ops).toContain("readMetadata")
    expect(ops).toContain("writeMetadata")
    expect(ops).toContain("closeTaskSuccess")
  })

  test("returns Processed with failure for exhausted task", async () => {
    readyQueue = [makeIssue("poll-fail")]
    claimResults.set("poll-fail", true)
    taskResult = { success: false, engine: "claude", error: "test error" }

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    expect(result._tag).toBe("Processed")
    if (result._tag === "Processed") {
      expect(result.result.success).toBe(false)
      expect(result.result.error).toBe("test error")
    }

    expect(calls.some((c) => c.op === "markTaskExhaustedFailure")).toBe(true)
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
  })
})

describe("pollClaimAndProcess: operation ordering", () => {
  test("operations execute in correct order: query → claim → read → write → execute → write → close", async () => {
    readyQueue = [makeIssue("poll-order")]
    claimResults.set("poll-order", true)
    taskResult = { success: true, engine: "claude" }

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    const ops = calls.map((c) => c.op)
    const queryIdx = ops.indexOf("queryQueued")
    const claimIdx = ops.indexOf("claimTask")
    const readIdx = ops.indexOf("readMetadata")
    const firstWriteIdx = ops.indexOf("writeMetadata")
    const closeIdx = ops.indexOf("closeTaskSuccess")

    expect(queryIdx).toBeLessThan(claimIdx)
    expect(claimIdx).toBeLessThan(readIdx)
    expect(readIdx).toBeLessThan(firstWriteIdx)
    expect(firstWriteIdx).toBeLessThan(closeIdx)
  })
})

describe("pollClaimAndProcess: prompt building", () => {
  test("prompt includes issue title and description", async () => {
    readyQueue = [{
      id: "poll-prompt",
      title: "Add user authentication",
      description: "Implement OAuth2 login flow",
    }]
    claimResults.set("poll-prompt", true)
    taskResult = { success: true, engine: "claude" }

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1"))

    expect(runTaskCalls.length).toBe(1)
    expect(runTaskCalls[0]!.prompt).toContain("Add user authentication")
    expect(runTaskCalls[0]!.prompt).toContain("Implement OAuth2 login flow")
  })
})
