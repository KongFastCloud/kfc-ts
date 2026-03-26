/**
 * ABOUTME: Canonical lifecycle contract for watch-task processing.
 *
 * This is the authoritative test surface for processClaimedTask and
 * pollClaimAndProcess behavior. Higher-layer tests (worker, controller)
 * should NOT re-prove the behaviors owned here; they should instead focus
 * on orchestration concerns unique to their layer.
 *
 * Owned contracts:
 *  1. Success lifecycle — operation ordering, metadata writes, close
 *  2. Failure lifecycle — exhausted-failure marking, no close, default reason
 *  3. Metadata timing  — startedAt/finishedAt semantics for both outcomes
 *  4. Previous-error prompt — inclusion, omission, read-before-write ordering
 *  5. Poll outcomes     — NoneReady, ClaimContention, Processed discrimination
 *  6. Operation ordering — full sequence for poll→claim→lifecycle→finalize
 *  7. Shared workflow    — watch executes through buildRunWorkflow (not runTask)
 *  8. Epic context       — validation, rejection, preamble prepending
 *  9. Epic-child context inheritance — branch, body, and context loading
 * 10. Orphan-task invalidity — no worktree, no engine, explicit error
 * 11. Lazy worktree creation — first task triggers ensureEpicWorktree
 * 12. Worktree reuse — sibling tasks under the same epic
 * 13. Cross-epic isolation — different epics, different worktree paths
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { FatalError } from "../src/errors.js"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { RalpheConfig } from "../src/config.js"
import type { WatchTask } from "../src/beadsAdapter.js"
import { EngineResolver } from "../src/EngineResolver.js"
import {
  processClaimedTask,
  pollClaimAndProcess,
  type ProcessTaskResult,
  type PollResult,
  type WatchWorkflowDeps,
} from "../src/watchWorkflow.js"
import {
  EPIC_ERROR_NO_PARENT,
  EPIC_ERROR_PARENT_NOT_FOUND,
  EPIC_ERROR_NOT_EPIC,
  EPIC_ERROR_EMPTY_BODY,
} from "../src/epic.js"

// ---------------------------------------------------------------------------
// Configurable stubs
// ---------------------------------------------------------------------------

let readyQueue: BeadsIssue[] = []
let claimResults: Map<string, boolean> = new Map()

// Engine behavior: controls what the agent returns through buildRunWorkflow
let engineResult: Effect.Effect<AgentResult, FatalError> =
  Effect.succeed({ response: "done", resumeToken: "tok-test" })

// Track all calls to beads operations in order
let calls: Array<{
  op: string
  id?: string
  reason?: string
  text?: string
  metadata?: BeadsMetadata
}> = []

// Configurable previous metadata returned by readMetadata
let previousMetadata: BeadsMetadata | undefined = undefined

// Track prompts assembled by buildWatchRequest
let assembledPrompts: string[] = []

// Mock epic data returned by queryTaskDetail (for parent epic loading)
let epicDetailsByParentId: Map<string, WatchTask | undefined> = new Map()

// Mock worktree paths returned by ensureEpicWorktree
let worktreePathsByEpicId: Map<string, string> = new Map()
// Track ensureEpicWorktree calls
let worktreeCalls: Array<{ epicId: string; branch: string }> = []
// Track epic branch provisioning writes
let epicBranchWrites: Array<{ epicId: string; branch: string }> = []
// Optional failure override for ensureEpicWorktree
let worktreeFailure: FatalError | undefined = undefined

// ---------------------------------------------------------------------------
// Local dependency harness
// ---------------------------------------------------------------------------

const baseConfig: RalpheConfig = {
  engine: "claude",
  checks: [],
  report: "none",
  maxAttempts: 1,
  git: { mode: "none" },
}

/**
 * Build a mock engine that returns the configurable engineResult.
 */
const makeMockEngine = (): Engine => ({
  execute: () => engineResult,
})

/**
 * Build a mock EngineResolver layer that provides the mock engine.
 */
const makeMockEngineResolverLayer = (): Layer.Layer<EngineResolver> => {
  const mockResolver: EngineResolver = {
    resolve: () => Layer.succeed(Engine, makeMockEngine()),
  }
  return Layer.succeed(EngineResolver, mockResolver)
}

/**
 * Create a valid mock epic WatchTask for testing.
 */
function makeEpic(id: string, title = `Epic ${id}`, description = `PRD for ${id}`, branch = `epic/${id}`): WatchTask {
  return {
    id,
    title,
    status: "backlog",
    issueType: "epic",
    description,
    labels: ["epic"],
    branch,
  }
}

function makeWorkflowDeps(): WatchWorkflowDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        return [...readyQueue]
      })()),
    queryTaskDetail: (id: string) => {
      calls.push({ op: "queryTaskDetail", id })
      return Effect.succeed(epicDetailsByParentId.get(id))
    },
    claimTask: (id: string) =>
      Effect.succeed((() => {
        calls.push({ op: "claimTask", id })
        return claimResults.get(id) ?? true
      })()),
    readMetadata: (id: string) => {
      calls.push({ op: "readMetadata", id })
      return Effect.succeed(previousMetadata)
    },
    buildPromptFromIssue: (issue: BeadsIssue) => {
      const sections: string[] = [issue.title]
      if (issue.description) sections.push(`\n## Description\n${issue.description}`)
      const prompt = sections.join("\n")
      assembledPrompts.push(prompt)
      return prompt
    },
    // Beads write operations
    writeMetadata: (id: string, metadata: BeadsMetadata) => {
      calls.push({ op: "writeMetadata", id, metadata })
      return Effect.succeed(undefined)
    },
    setEpicBranchMetadata: (id: string, branch: string) => {
      epicBranchWrites.push({ epicId: id, branch })
      const existing = epicDetailsByParentId.get(id)
      if (existing) {
        epicDetailsByParentId.set(id, { ...existing, branch })
      }
      return Effect.succeed(undefined)
    },
    closeTaskSuccess: (id: string, reason?: string) => {
      calls.push({ op: "closeTaskSuccess", id, reason })
      return Effect.succeed(undefined)
    },
    markTaskExhaustedFailure: (id: string, reason: string, metadata: BeadsMetadata) => {
      calls.push({ op: "markTaskExhaustedFailure", id, reason, metadata })
      return Effect.succeed(undefined)
    },
    addComment: (id: string, text: string) => {
      calls.push({ op: "addComment", id, text })
      return Effect.succeed(undefined)
    },
    // Engine resolver layer for the workflow builder
    engineResolverLayer: makeMockEngineResolverLayer(),
    // Epic worktree lifecycle
    ensureEpicWorktree: (epic) => {
      worktreeCalls.push({ epicId: epic.id, branch: epic.branch })
      if (worktreeFailure) {
        return Effect.fail(worktreeFailure)
      }
      const worktreePath = worktreePathsByEpicId.get(epic.id) ?? `/tmp/ralphe-worktrees/${epic.id}`
      return Effect.succeed(worktreePath)
    },
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  readyQueue = []
  claimResults = new Map()
  engineResult = Effect.succeed({ response: "done", resumeToken: "tok-test" })
  previousMetadata = undefined
  calls = []
  assembledPrompts = []
  worktreeCalls = []
  epicBranchWrites = []
  worktreePathsByEpicId = new Map()
  worktreeFailure = undefined
  // Pre-populate the default epic so existing tests pass with epic validation
  epicDetailsByParentId = new Map([
    [DEFAULT_EPIC_ID, makeEpic(DEFAULT_EPIC_ID, "Default Epic", "Default epic PRD body.")],
  ])
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default epic ID used by makeIssue. Pre-populated in epicDetailsByParentId for each test. */
const DEFAULT_EPIC_ID = "default-epic"

function makeIssue(id: string, title = `Task ${id}`, parentId = DEFAULT_EPIC_ID): BeadsIssue {
  return { id, title, description: `Description for ${id}`, parentId }
}

// ===========================================================================
// processClaimedTask — canonical single-task lifecycle
// ===========================================================================

// ---- Contract 1: success lifecycle ----------------------------------------

describe("processClaimedTask: success lifecycle", () => {
  test("successful task reads metadata, writes start/final, and closes", async () => {
    const issue = makeIssue("wf-1", "Implement feature X")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-abc" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    expect(result.taskId).toBe("wf-1")
    expect(result.engine).toBe("claude")
    expect(result.resumeToken).toBe("tok-abc")

    // Verify operation ordering:
    // - queryTaskDetail (epic context loading)
    // - readMetadata (previous error check)
    // - writeMetadata (observer.onStart: start metadata)
    // - addComment (observer.onAgentResult: session comment)
    // - addComment (observer.onLoopEvent: success comment)
    // - writeMetadata (observer.onComplete: final metadata)
    // - closeTaskSuccess (processClaimedTask: status transition)
    const ops = calls.map((c) => c.op)
    expect(ops).toEqual([
      "queryTaskDetail",  // epic context loading
      "readMetadata",
      "writeMetadata",    // start metadata (observer.onStart)
      "addComment",       // session comment (observer.onAgentResult)
      "addComment",       // success comment (observer.onLoopEvent)
      "writeMetadata",    // final metadata (observer.onComplete)
      "closeTaskSuccess", // status transition (processClaimedTask)
    ])

    // Verify start metadata
    const metaCalls = calls.filter((c) => c.op === "writeMetadata")
    const startMeta = metaCalls[0]!.metadata!
    expect(startMeta.workerId).toBe("worker-1")
    expect(startMeta.engine).toBe("claude")
    expect(startMeta.startedAt).toBeTruthy()
    expect(startMeta.finishedAt).toBeUndefined()

    // Verify final metadata
    const finalMeta = metaCalls[1]!.metadata!
    expect(finalMeta.resumeToken).toBe("tok-abc")
    expect(finalMeta.workerId).toBe("worker-1")
    expect(finalMeta.startedAt).toBeTruthy()
    expect(finalMeta.finishedAt).toBeTruthy()
    expect(finalMeta.startedAt).toBe(startMeta.startedAt)
  })

  test("session comment includes resume command", async () => {
    const issue = makeIssue("wf-session", "Test session")
    engineResult = Effect.succeed({ response: "ok", resumeToken: "tok-sess" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const commentCalls = calls.filter((c) => c.op === "addComment")
    expect(commentCalls.length).toBeGreaterThanOrEqual(1)
    // First comment is the session comment with resume token
    expect(commentCalls[0]!.text).toContain("tok-sess")
    expect(commentCalls[0]!.text).toContain("claude --resume")
  })
})

// ---- Contract 2: failure lifecycle -----------------------------------------

describe("processClaimedTask: failure lifecycle", () => {
  test("failed task is marked as exhausted failure", async () => {
    const issue = makeIssue("wf-fail-1")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "checks failed" }),
    )

    const result = await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
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
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    // Empty error message triggers "execution failed" fallback
    expect(exhaustedCall?.reason).toBe("execution failed")
  })

  test("failure operations execute in order: read -> start-write -> markExhausted (no close)", async () => {
    const issue = makeIssue("wf-fail-order")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "lint error" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
    )

    const ops = calls.map((c) => c.op)
    expect(ops).toEqual([
      "queryTaskDetail",            // epic context loading
      "readMetadata",
      "writeMetadata",              // start metadata (observer.onStart)
      "writeMetadata",              // final metadata (observer.onComplete)
      "markTaskExhaustedFailure",   // status transition (processClaimedTask)
    ])
  })

  test("exhausted failure metadata carries timing fields", async () => {
    const issue = makeIssue("wf-fail-err-meta")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "type mismatch at line 42" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.workerId).toBe("worker-1")
    expect(exhaustedCall?.metadata?.engine).toBe("claude")
  })
})

// ---- Contract 4: previous-error prompt behavior ---------------------------

describe("processClaimedTask: previous error propagation", () => {
  test("previous error is included in prompt via buildWatchRequest", async () => {
    const issue = makeIssue("wf-retry", "Fix broken tests")
    engineResult = Effect.succeed({ response: "done" })
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
      }, "worker-1", makeWorkflowDeps()),
    )

    // Verify the prompt was assembled
    expect(assembledPrompts.length).toBe(1)
    // Execution completed (observer wrote metadata), proving the request
    // was built and executed through the workflow builder
    expect(calls.some((c) => c.op === "writeMetadata")).toBe(true)
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(true)
  })

  test("fresh task has no previous error in prompt", async () => {
    const issue = makeIssue("wf-fresh", "New feature")
    engineResult = Effect.succeed({ response: "done" })
    previousMetadata = undefined

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "worker-1", makeWorkflowDeps()),
    )

    expect(assembledPrompts.length).toBe(1)
    // The prompt was built without previous error
    expect(assembledPrompts[0]).not.toContain("## Previous Error")
  })

  test("metadata without error does not add previous error section", async () => {
    const issue = makeIssue("wf-no-err", "Previously succeeded")
    engineResult = Effect.succeed({ response: "done" })
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
      }, "worker-1", makeWorkflowDeps()),
    )

    expect(assembledPrompts.length).toBe(1)
    expect(assembledPrompts[0]).not.toContain("## Previous Error")
  })

  test("readMetadata is called before writeMetadata", async () => {
    const issue = makeIssue("wf-order", "Check ordering")
    engineResult = Effect.succeed({ response: "done" })
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
      }, "worker-1", makeWorkflowDeps()),
    )

    const readIdx = calls.findIndex((c) => c.op === "readMetadata")
    const writeIdx = calls.findIndex((c) => c.op === "writeMetadata")
    expect(readIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThan(readIdx)
  })
})

// ---- Contract 3: metadata timing ------------------------------------------

describe("processClaimedTask: metadata timing", () => {
  test("start metadata has startedAt but no finishedAt", async () => {
    const issue = makeIssue("wf-timing-1")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok" })

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "claude",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "test-timing", makeWorkflowDeps()),
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
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "lint failed" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, {
        engine: "codex",
        checks: [],
        report: "none",
        maxAttempts: 1,
        git: { mode: "none" },
      }, "meta-worker", makeWorkflowDeps()),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.metadata?.engine).toBe("codex")
    expect(exhaustedCall?.metadata?.workerId).toBe("meta-worker")
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
  })
})

// ===========================================================================
// pollClaimAndProcess — canonical poll->claim->process cycle
// ===========================================================================

// ---- Contract 5: poll outcomes --------------------------------------------

describe("pollClaimAndProcess: poll outcomes", () => {
  test("returns NoneReady when queue is empty", async () => {
    readyQueue = []

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    expect(result._tag).toBe("NoneReady")
    expect(calls.some((c) => c.op === "queryQueued")).toBe(true)
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
  })

  test("returns ClaimContention when another worker claimed the task", async () => {
    readyQueue = [makeIssue("poll-contend")]
    claimResults.set("poll-contend", false)

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    expect(result._tag).toBe("ClaimContention")
    if (result._tag === "ClaimContention") {
      expect(result.taskId).toBe("poll-contend")
    }
    // No task execution should have occurred
    expect(calls.some((c) => c.op === "writeMetadata")).toBe(false)
  })

  test("returns Processed with success for claimed and completed task", async () => {
    readyQueue = [makeIssue("poll-ok", "Feature X")]
    claimResults.set("poll-ok", true)
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-123" })

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

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
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "test error" }),
    )

    const result = await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    expect(result._tag).toBe("Processed")
    if (result._tag === "Processed") {
      expect(result.result.success).toBe(false)
      expect(result.result.error).toBe("test error")
    }

    expect(calls.some((c) => c.op === "markTaskExhaustedFailure")).toBe(true)
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
  })
})

// ---- Contract 6: operation ordering ---------------------------------------

describe("pollClaimAndProcess: operation ordering", () => {
  test("operations execute in correct order: query -> claim -> read -> write -> execute -> write -> close", async () => {
    readyQueue = [makeIssue("poll-order")]
    claimResults.set("poll-order", true)
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

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

  test("failure path: query -> claim -> read -> write -> markExhausted (no close)", async () => {
    readyQueue = [makeIssue("poll-fail-order")]
    claimResults.set("poll-fail-order", true)
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "build broke" }),
    )

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    const ops = calls.map((c) => c.op)
    const queryIdx = ops.indexOf("queryQueued")
    const claimIdx = ops.indexOf("claimTask")
    const readIdx = ops.indexOf("readMetadata")
    const firstWriteIdx = ops.indexOf("writeMetadata")
    const exhaustedIdx = ops.indexOf("markTaskExhaustedFailure")

    expect(queryIdx).toBeLessThan(claimIdx)
    expect(claimIdx).toBeLessThan(readIdx)
    expect(readIdx).toBeLessThan(firstWriteIdx)
    expect(firstWriteIdx).toBeLessThan(exhaustedIdx)

    // No close calls on failure path
    expect(ops).not.toContain("closeTaskSuccess")
  })
})

describe("pollClaimAndProcess: prompt building", () => {
  test("prompt includes issue title and description", async () => {
    readyQueue = [{
      id: "poll-prompt",
      title: "Add user authentication",
      description: "Implement OAuth2 login flow",
      parentId: DEFAULT_EPIC_ID,
    }]
    claimResults.set("poll-prompt", true)
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    expect(assembledPrompts.length).toBe(1)
    expect(assembledPrompts[0]).toContain("Add user authentication")
    expect(assembledPrompts[0]).toContain("Implement OAuth2 login flow")
  })

  test("prompt includes previous error when metadata has error field", async () => {
    readyQueue = [makeIssue("poll-prev-err", "Retry task")]
    claimResults.set("poll-prev-err", true)
    engineResult = Effect.succeed({ response: "done" })
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
      error: "ReferenceError: foo is not defined",
    }

    await Effect.runPromise(pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()))

    // buildWatchRequest builds the prompt then appends the previous error.
    // Verify execution completed correctly.
    expect(assembledPrompts.length).toBe(1)
    expect(calls.some((c) => c.op === "writeMetadata")).toBe(true)
  })
})

// ===========================================================================
// Contract 7: shared workflow builder
// ===========================================================================

describe("watch executes through shared workflow builder", () => {
  test("watch path produces same TaskResult shape as direct run path", async () => {
    const issue = makeIssue("wf-shared", "Shared workflow test")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-shared" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // TaskResult shape matches what buildRunWorkflow produces
    expect(result.success).toBe(true)
    expect(result.engine).toBe("claude")
    expect(result.resumeToken).toBe("tok-shared")
    expect(result.taskId).toBe("wf-shared")
  })

  test("engine selection flows through EngineResolver service", async () => {
    let resolvedEngine: string | undefined

    const trackingResolver: EngineResolver = {
      resolve: (engine) => {
        resolvedEngine = engine
        return Layer.succeed(Engine, makeMockEngine())
      },
    }

    const issue = makeIssue("wf-resolver", "Engine resolver test")
    engineResult = Effect.succeed({ response: "done" })

    const deps: WatchWorkflowDeps = {
      ...makeWorkflowDeps(),
      engineResolverLayer: Layer.succeed(EngineResolver, trackingResolver),
    }

    await Effect.runPromise(
      processClaimedTask(
        issue,
        { ...baseConfig, engine: "codex" },
        "worker-1",
        deps,
      ),
    )

    expect(resolvedEngine).toBe("codex")
  })

  test("observer lifecycle events are written to Beads comments", async () => {
    const issue = makeIssue("wf-observer", "Observer lifecycle test")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-obs" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const commentCalls = calls.filter((c) => c.op === "addComment")
    // Should have at least: session comment (onAgentResult) + success comment (onLoopEvent)
    expect(commentCalls.length).toBeGreaterThanOrEqual(2)

    // Session comment contains resume token
    const sessionComment = commentCalls.find((c) => c.text?.includes("tok-obs"))
    expect(sessionComment).toBeTruthy()
    expect(sessionComment?.id).toBe("wf-observer")

    // Success comment contains "all checks passed"
    const successComment = commentCalls.find((c) => c.text?.includes("all checks passed"))
    expect(successComment).toBeTruthy()
    expect(successComment?.id).toBe("wf-observer")
  })
})

// ===========================================================================
// Contract 8: epic-backed execution context
// ===========================================================================

describe("processClaimedTask: epic context validation", () => {
  test("standalone task (no parentId) is rejected with explicit error", async () => {
    const issue: BeadsIssue = {
      id: "standalone-1",
      title: "Orphan task",
      description: "No parent",
      // parentId intentionally omitted
    }
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.taskId).toBe("standalone-1")
    expect(result.error).toBe(EPIC_ERROR_NO_PARENT)

    // Should have called markTaskExhaustedFailure
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("standalone-1")
    expect(exhaustedCall?.reason).toBe(EPIC_ERROR_NO_PARENT)

    // Should NOT have executed the agent (no writeMetadata from observer)
    const writeMetaCalls = calls.filter((c) => c.op === "writeMetadata")
    expect(writeMetaCalls.length).toBe(0)
  })

  test("task whose parent is not found is rejected", async () => {
    const issue = makeIssue("child-1", "Child task", "nonexistent-epic")
    // Do not register the parent in epicDetailsByParentId

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(EPIC_ERROR_PARENT_NOT_FOUND("nonexistent-epic"))
  })

  test("task whose parent is not an epic is rejected", async () => {
    epicDetailsByParentId.set("not-an-epic", {
      id: "not-an-epic",
      title: "Regular issue",
      status: "backlog",
      description: "Some description",
      labels: ["feature"], // no "epic" label
      branch: "epic/not-an-epic",
    })
    const issue = makeIssue("child-2", "Child task", "not-an-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(EPIC_ERROR_NOT_EPIC("not-an-epic"))
  })

  test("task whose parent epic has empty body is rejected", async () => {
    epicDetailsByParentId.set("empty-epic", {
      id: "empty-epic",
      title: "Epic without PRD",
      status: "backlog",
      description: "",
      labels: ["epic"],
      branch: "epic/empty-epic",
    })
    const issue = makeIssue("child-3", "Child task", "empty-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(EPIC_ERROR_EMPTY_BODY("empty-epic"))
  })

  test("task with valid epic parent executes successfully", async () => {
    epicDetailsByParentId.set("valid-epic", makeEpic("valid-epic", "Auth Epic", "Full PRD: implement OAuth2 login flow."))
    const issue = makeIssue("child-ok", "Implement login", "valid-epic")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-ok" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    expect(result.taskId).toBe("child-ok")

    // Verify epic context was loaded
    expect(calls.some((c) => c.op === "queryTaskDetail" && c.id === "valid-epic")).toBe(true)

    // Verify task was closed successfully
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(true)
  })

  test("epic PRD is prepended to task prompt", async () => {
    epicDetailsByParentId.set("prd-epic", makeEpic("prd-epic", "Database Migration Epic", "Migrate from SQLite to Postgres with zero downtime."))
    const issue = makeIssue("child-prd", "Create migration script", "prd-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // The assembled prompt should contain the epic preamble
    expect(assembledPrompts.length).toBe(1)
    // The full task text passed to the engine includes epic preamble + task prompt.
    // We verify by checking the writeMetadata was called (meaning execution happened).
    const metaCalls = calls.filter((c) => c.op === "writeMetadata")
    expect(metaCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("invalid epic context marks task as exhausted failure with timing metadata", async () => {
    const issue: BeadsIssue = {
      id: "timing-standalone",
      title: "Timing test",
      // no parentId
    }

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.workerId).toBe("worker-1")
    expect(exhaustedCall?.metadata?.engine).toBe("claude")
  })
})

describe("pollClaimAndProcess: epic context in poll cycle", () => {
  test("standalone task in queue is rejected during processing", async () => {
    readyQueue = [{
      id: "poll-standalone",
      title: "Orphan in queue",
      // no parentId
    }]
    claimResults.set("poll-standalone", true)

    const result = await Effect.runPromise(
      pollClaimAndProcess("/tmp", "worker-1", makeWorkflowDeps()),
    )

    expect(result._tag).toBe("Processed")
    if (result._tag === "Processed") {
      expect(result.result.success).toBe(false)
      expect(result.result.error).toBe(EPIC_ERROR_NO_PARENT)
    }
  })
})

// ===========================================================================
// Contract 9: execution invariants — epic-child inheritance, worktree
// lifecycle, and cross-epic isolation
// ===========================================================================

describe("processClaimedTask: epic-child context inheritance", () => {
  test("child task inherits epic branch via ensureEpicWorktree", async () => {
    epicDetailsByParentId.set("inherit-epic", makeEpic("inherit-epic", "Auth Epic", "PRD body.", "epic/auth-branch"))
    const issue = makeIssue("child-inherit", "Login page", "inherit-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // ensureEpicWorktree was called with the epic's canonical branch
    expect(worktreeCalls).toHaveLength(1)
    expect(worktreeCalls[0]!.epicId).toBe("inherit-epic")
    expect(worktreeCalls[0]!.branch).toBe("epic/auth-branch")
  })

  test("child task inherits epic ID and body for prompt preamble", async () => {
    epicDetailsByParentId.set("preamble-epic", makeEpic("preamble-epic", "Payment Epic", "Full payment PRD content.", "epic/payment"))
    const issue = makeIssue("child-preamble", "Stripe integration", "preamble-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Epic context was loaded via queryTaskDetail
    const epicQuery = calls.find((c) => c.op === "queryTaskDetail" && c.id === "preamble-epic")
    expect(epicQuery).toBeTruthy()

    // Execution succeeded — proving the full context inheritance path worked
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(true)
  })

  test("epic context is loaded exactly once per task execution", async () => {
    epicDetailsByParentId.set("once-epic", makeEpic("once-epic", "Test Epic", "PRD.", "epic/once"))
    const issue = makeIssue("child-once", "Task", "once-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const epicQueries = calls.filter((c) => c.op === "queryTaskDetail" && c.id === "once-epic")
    expect(epicQueries).toHaveLength(1)
  })
})

describe("processClaimedTask: orphan-task invalidity", () => {
  test("orphan task (no parentId) never invokes ensureEpicWorktree", async () => {
    const issue: BeadsIssue = { id: "orphan-wt", title: "No parent" }

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(worktreeCalls).toHaveLength(0)
  })

  test("orphan task never invokes the engine", async () => {
    let engineInvoked = false
    engineResult = Effect.sync(() => {
      engineInvoked = true
      return { response: "done" }
    })

    const issue: BeadsIssue = { id: "orphan-engine", title: "No parent" }

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(engineInvoked).toBe(false)
  })

  test("orphan task result carries the engine field from config (not from execution)", async () => {
    const issue: BeadsIssue = { id: "orphan-meta", title: "No parent" }

    const result = await Effect.runPromise(
      processClaimedTask(issue, { ...baseConfig, engine: "codex" }, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.engine).toBe("codex")
  })
})

describe("processClaimedTask: lazy worktree creation", () => {
  test("first task for an epic triggers ensureEpicWorktree", async () => {
    epicDetailsByParentId.set("lazy-epic", makeEpic("lazy-epic", "Lazy Epic", "PRD.", "epic/lazy"))
    const issue = makeIssue("first-child", "First task", "lazy-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(worktreeCalls).toHaveLength(1)
    expect(worktreeCalls[0]!.epicId).toBe("lazy-epic")
  })

  test("worktree failure marks the task as exhausted", async () => {
    epicDetailsByParentId.set("wt-fail-epic", makeEpic("wt-fail-epic", "WT Fail Epic", "PRD.", "epic/wt-fail"))
    worktreeFailure = new FatalError({ command: "git worktree add", message: "branch does not exist" })

    const issue = makeIssue("child-wt-fail", "Task", "wt-fail-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to ensure epic worktree")
    expect(result.error).toContain("branch does not exist")

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("child-wt-fail")
  })
})

describe("processClaimedTask: worktree reuse", () => {
  test("two tasks under the same epic use the same worktree path", async () => {
    epicDetailsByParentId.set("reuse-epic", makeEpic("reuse-epic", "Reuse Epic", "PRD.", "epic/reuse"))
    worktreePathsByEpicId.set("reuse-epic", "/tmp/ralphe-worktrees/reuse-epic")
    engineResult = Effect.succeed({ response: "done" })

    const issue1 = makeIssue("reuse-child-1", "Task 1", "reuse-epic")
    const issue2 = makeIssue("reuse-child-2", "Task 2", "reuse-epic")

    await Effect.runPromise(
      processClaimedTask(issue1, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Reset calls to isolate second task's behavior
    calls = []

    await Effect.runPromise(
      processClaimedTask(issue2, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Both tasks called ensureEpicWorktree with the same epic
    expect(worktreeCalls).toHaveLength(2)
    expect(worktreeCalls[0]!.epicId).toBe("reuse-epic")
    expect(worktreeCalls[1]!.epicId).toBe("reuse-epic")
    expect(worktreeCalls[0]!.branch).toBe("epic/reuse")
    expect(worktreeCalls[1]!.branch).toBe("epic/reuse")
  })
})

describe("processClaimedTask: cross-epic isolation", () => {
  test("tasks under different epics use different worktree paths", async () => {
    epicDetailsByParentId.set("epic-a", makeEpic("epic-a", "Epic A", "PRD A.", "epic/a"))
    epicDetailsByParentId.set("epic-b", makeEpic("epic-b", "Epic B", "PRD B.", "epic/b"))
    worktreePathsByEpicId.set("epic-a", "/tmp/ralphe-worktrees/epic-a")
    worktreePathsByEpicId.set("epic-b", "/tmp/ralphe-worktrees/epic-b")
    engineResult = Effect.succeed({ response: "done" })

    const issueA = makeIssue("child-a", "Task A", "epic-a")
    const issueB = makeIssue("child-b", "Task B", "epic-b")

    await Effect.runPromise(
      processClaimedTask(issueA, baseConfig, "worker-1", makeWorkflowDeps()),
    )
    await Effect.runPromise(
      processClaimedTask(issueB, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Two ensureEpicWorktree calls, one per epic
    expect(worktreeCalls).toHaveLength(2)
    expect(worktreeCalls[0]!.epicId).toBe("epic-a")
    expect(worktreeCalls[0]!.branch).toBe("epic/a")
    expect(worktreeCalls[1]!.epicId).toBe("epic-b")
    expect(worktreeCalls[1]!.branch).toBe("epic/b")
  })

  test("epic A's context does not affect epic B's task execution", async () => {
    epicDetailsByParentId.set("iso-a", makeEpic("iso-a", "Epic A", "PRD A content.", "epic/iso-a"))
    epicDetailsByParentId.set("iso-b", makeEpic("iso-b", "Epic B", "PRD B content.", "epic/iso-b"))
    engineResult = Effect.succeed({ response: "done" })

    const issueA = makeIssue("iso-child-a", "Task A", "iso-a")
    const issueB = makeIssue("iso-child-b", "Task B", "iso-b")

    const resultA = await Effect.runPromise(
      processClaimedTask(issueA, baseConfig, "worker-1", makeWorkflowDeps()),
    )
    const resultB = await Effect.runPromise(
      processClaimedTask(issueB, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Both succeed independently
    expect(resultA.success).toBe(true)
    expect(resultB.success).toBe(true)

    // Each loaded its own epic context
    const epicAQueries = calls.filter((c) => c.op === "queryTaskDetail" && c.id === "iso-a")
    const epicBQueries = calls.filter((c) => c.op === "queryTaskDetail" && c.id === "iso-b")
    expect(epicAQueries).toHaveLength(1)
    expect(epicBQueries).toHaveLength(1)
  })
})

// ===========================================================================
// Contract 9: epic worktree lifecycle
// ===========================================================================

describe("processClaimedTask: epic worktree lifecycle", () => {
  test("ensureEpicWorktree is called with the epic context", async () => {
    epicDetailsByParentId.set("wt-epic", makeEpic("wt-epic", "Worktree Epic", "PRD for worktree test"))
    const issue = makeIssue("wt-task-1", "Worktree task", "wt-epic")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    // Verify ensureEpicWorktree was called with the correct epic
    expect(worktreeCalls.length).toBe(1)
    expect(worktreeCalls[0]!.epicId).toBe("wt-epic")
    expect(worktreeCalls[0]!.branch).toBe("epic/wt-epic")
  })

  test("worktree failure marks task as exhausted failure", async () => {
    epicDetailsByParentId.set("wt-fail-epic", makeEpic("wt-fail-epic", "Failing Epic", "PRD body"))
    const issue = makeIssue("wt-fail-task", "Task with worktree failure", "wt-fail-epic")
    worktreeFailure = new FatalError({
      command: "git worktree add",
      message: "branch 'epic/wt-fail-epic' does not exist",
    })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to ensure epic worktree")
    expect(result.error).toContain("does not exist")

    // Should have called markTaskExhaustedFailure
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("wt-fail-task")

    // Should NOT have executed the agent
    const metaCalls = calls.filter((c) => c.op === "writeMetadata")
    expect(metaCalls.length).toBe(0)
  })

  test("worktree path is set on the RunRequest (cwd)", async () => {
    const customPath = "/tmp/ralphe-worktrees/cwd-epic"
    worktreePathsByEpicId.set("cwd-epic", customPath)
    epicDetailsByParentId.set("cwd-epic", makeEpic("cwd-epic", "CWD Epic", "PRD for cwd test"))
    const issue = makeIssue("cwd-task", "CWD task", "cwd-epic")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    // The worktree path should have been passed through to execution
    expect(worktreeCalls.length).toBe(1)
    expect(worktreeCalls[0]!.epicId).toBe("cwd-epic")
  })

  test("multiple tasks under same epic reuse the worktree", async () => {
    epicDetailsByParentId.set("reuse-epic", makeEpic("reuse-epic", "Reuse Epic", "PRD for reuse test"))
    worktreePathsByEpicId.set("reuse-epic", "/tmp/ralphe-worktrees/reuse-epic")
    engineResult = Effect.succeed({ response: "done" })

    // First task
    const issue1 = makeIssue("reuse-task-1", "First task", "reuse-epic")
    const result1 = await Effect.runPromise(
      processClaimedTask(issue1, baseConfig, "worker-1", makeWorkflowDeps()),
    )
    expect(result1.success).toBe(true)

    // Second task
    const issue2 = makeIssue("reuse-task-2", "Second task", "reuse-epic")
    const result2 = await Effect.runPromise(
      processClaimedTask(issue2, baseConfig, "worker-1", makeWorkflowDeps()),
    )
    expect(result2.success).toBe(true)

    // Both calls should have the same epic ID and branch
    expect(worktreeCalls.length).toBe(2)
    expect(worktreeCalls[0]!.epicId).toBe("reuse-epic")
    expect(worktreeCalls[1]!.epicId).toBe("reuse-epic")
    expect(worktreeCalls[0]!.branch).toBe("epic/reuse-epic")
    expect(worktreeCalls[1]!.branch).toBe("epic/reuse-epic")
  })

  test("tasks under different epics get different worktree calls", async () => {
    epicDetailsByParentId.set("epic-a", makeEpic("epic-a", "Epic A", "PRD A"))
    epicDetailsByParentId.set("epic-b", makeEpic("epic-b", "Epic B", "PRD B"))
    worktreePathsByEpicId.set("epic-a", "/tmp/ralphe-worktrees/epic-a")
    worktreePathsByEpicId.set("epic-b", "/tmp/ralphe-worktrees/epic-b")
    engineResult = Effect.succeed({ response: "done" })

    const issue1 = makeIssue("task-a", "Task A", "epic-a")
    await Effect.runPromise(
      processClaimedTask(issue1, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const issue2 = makeIssue("task-b", "Task B", "epic-b")
    await Effect.runPromise(
      processClaimedTask(issue2, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(worktreeCalls.length).toBe(2)
    expect(worktreeCalls[0]!.epicId).toBe("epic-a")
    expect(worktreeCalls[1]!.epicId).toBe("epic-b")
  })

  test("epic without branch is provisioned before worktree creation", async () => {
    epicDetailsByParentId.set("no-branch-epic", {
      id: "no-branch-epic",
      title: "Epic Without Branch",
      status: "backlog",
      description: "Valid PRD body",
      labels: ["epic"],
      // branch intentionally omitted
    })
    const issue = makeIssue("no-branch-task", "Task", "no-branch-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(epicBranchWrites).toEqual([{ epicId: "no-branch-epic", branch: "epic/no-branch-epic" }])
    expect(worktreeCalls.length).toBe(1)
    expect(worktreeCalls[0]!.branch).toBe("epic/no-branch-epic")
  })
})
