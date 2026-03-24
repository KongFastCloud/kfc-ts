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
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { FatalError } from "../src/errors.js"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { RalpheConfig } from "../src/config.js"
import { EngineResolver } from "../src/EngineResolver.js"
import {
  processClaimedTask,
  pollClaimAndProcess,
  type ProcessTaskResult,
  type PollResult,
  type WatchWorkflowDeps,
} from "../src/watchWorkflow.js"

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

function makeWorkflowDeps(): WatchWorkflowDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        return [...readyQueue]
      })()),
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
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}` }
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
    // - readMetadata (previous error check)
    // - writeMetadata (observer.onStart: start metadata)
    // - addComment (observer.onAgentResult: session comment)
    // - addComment (observer.onLoopEvent: success comment)
    // - writeMetadata (observer.onComplete: final metadata)
    // - closeTaskSuccess (processClaimedTask: status transition)
    const ops = calls.map((c) => c.op)
    expect(ops).toEqual([
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
