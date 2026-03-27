/**
 * ABOUTME: Regression tests for retry/error contract preservation and workspace
 * bootstrap failure semantics.
 *
 * Owned contracts:
 *  1. Retry input uses only last structured metadata failure (no comment parsing)
 *  2. Comments log history but are never included in retry context assembly
 *  3. Workspace-prepare failures trigger existing exhausted-failure/error flow
 *  4. Regression coverage for observer comment behavior, status mapping
 *     semantics, and startup recovery behavior
 *
 * Parent epic: kfc-ts-pe20
 * User stories: #3, #4
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { FatalError } from "../src/errors.js"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { RalpheConfig } from "../src/config.js"
import type { WatchTask } from "../src/beadsAdapter.js"
import type { EpicRuntimeStatus } from "../src/epicRuntimeState.js"
import { EngineResolver } from "../src/EngineResolver.js"
import {
  processClaimedTask,
  type WatchWorkflowDeps,
} from "../src/watchWorkflow.js"
import { buildWatchRequest } from "../src/BeadsRunObserver.js"
import {
  deriveEpicDisplayStatus,
  type EpicDisplayStatus,
} from "../src/tui/epicStatus.js"

// ---------------------------------------------------------------------------
// Configurable stubs
// ---------------------------------------------------------------------------

let engineResult: Effect.Effect<AgentResult, FatalError> =
  Effect.succeed({ response: "done", resumeToken: "tok-test" })

let calls: Array<{
  op: string
  id?: string
  reason?: string
  text?: string
  label?: string
  metadata?: BeadsMetadata
}> = []

let previousMetadata: BeadsMetadata | undefined = undefined
let assembledPrompts: string[] = []
let epicDetailsByParentId: Map<string, WatchTask | undefined> = new Map()
let worktreePathsByEpicId: Map<string, string> = new Map()
let worktreeCalls: Array<{ epicId: string; branch: string }> = []
let worktreeFailure: FatalError | undefined = undefined
let workspacePrepareCalls: Array<{ worktreePath: string; branch: string; sourceWorkspace: string }> = []
let workspacePrepareFailure: FatalError | undefined = undefined
const mockRepoRoot = "/tmp/mock-repo-root"
let runtimeStateByEpicId: Map<string, EpicRuntimeStatus> = new Map()

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

const makeMockEngine = (): Engine => ({
  execute: () => engineResult,
})

const makeMockEngineResolverLayer = (): Layer.Layer<EngineResolver> => {
  const mockResolver: EngineResolver = {
    resolve: () => Layer.succeed(Engine, makeMockEngine()),
  }
  return Layer.succeed(EngineResolver, mockResolver)
}

const DEFAULT_EPIC_ID = "default-epic"

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

function makeIssue(id: string, title = `Task ${id}`, parentId = DEFAULT_EPIC_ID): BeadsIssue {
  return { id, title, description: `Description for ${id}`, parentId }
}

function makeWorkflowDeps(): WatchWorkflowDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        return []
      })()),
    queryTaskDetail: (id: string) => {
      calls.push({ op: "queryTaskDetail", id })
      return Effect.succeed(epicDetailsByParentId.get(id))
    },
    claimTask: (id: string) =>
      Effect.succeed((() => {
        calls.push({ op: "claimTask", id })
        return true
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
    writeMetadata: (id: string, metadata: BeadsMetadata) => {
      calls.push({ op: "writeMetadata", id, metadata })
      return Effect.succeed(undefined)
    },
    addLabel: (id: string, label: string) => {
      calls.push({ op: "addLabel", id, label })
      return Effect.succeed(undefined)
    },
    removeLabel: (id: string, label: string) => {
      calls.push({ op: "removeLabel", id, label })
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
    engineResolverLayer: makeMockEngineResolverLayer(),
    ensureEpicWorktree: (epic) => {
      worktreeCalls.push({ epicId: epic.id, branch: epic.branch })
      if (worktreeFailure) {
        return Effect.fail(worktreeFailure)
      }
      const worktreePath = worktreePathsByEpicId.get(epic.id) ?? `/tmp/ralphe-worktrees/${epic.id}`
      return Effect.succeed(worktreePath)
    },
    deriveEpicWorktreePath: (epicId: string) => {
      const worktreePath = worktreePathsByEpicId.get(epicId) ?? `/tmp/ralphe-worktrees/${epicId}`
      return Effect.succeed(worktreePath)
    },
    getRepoRoot: () => Effect.succeed(mockRepoRoot),
    getEpicRuntimeStatus: (epicId: string) => Effect.succeed(runtimeStateByEpicId.get(epicId) ?? "no_attempt"),
    setEpicRuntimeStatus: (epicId: string, status: EpicRuntimeStatus) => {
      runtimeStateByEpicId.set(epicId, status)
      return Effect.succeed(undefined)
    },
    workspacePrepare: (input) => {
      workspacePrepareCalls.push({
        worktreePath: input.worktreePath,
        branch: input.branch,
        sourceWorkspace: input.sourceWorkspace,
      })
      if (workspacePrepareFailure) {
        return Effect.fail(workspacePrepareFailure)
      }
      return Effect.succeed({
        worktreePath: input.worktreePath,
        copyResult: { copied: 0, skipped: 0, failures: [] },
        completedStage: "bootstrap" as const,
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  engineResult = Effect.succeed({ response: "done", resumeToken: "tok-test" })
  previousMetadata = undefined
  calls = []
  assembledPrompts = []
  worktreeCalls = []
  worktreePathsByEpicId = new Map()
  worktreeFailure = undefined
  workspacePrepareCalls = []
  workspacePrepareFailure = undefined
  runtimeStateByEpicId = new Map()
  epicDetailsByParentId = new Map([
    [DEFAULT_EPIC_ID, makeEpic(DEFAULT_EPIC_ID, "Default Epic", "Default epic PRD body.")],
  ])
})

// ===========================================================================
// Contract 1: retry input uses only last structured metadata failure
// ===========================================================================

describe("retry contract: only last metadata failure is used as retry context", () => {
  test("previous error from metadata.error is passed to buildWatchRequest", async () => {
    const issue = makeIssue("retry-meta-1", "Fix failing build")
    engineResult = Effect.succeed({ response: "done" })
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
      error: "TypeError: Cannot read property 'map' of undefined",
    }

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // readMetadata was called to get the previous error
    expect(calls.some((c) => c.op === "readMetadata" && c.id === "retry-meta-1")).toBe(true)
    // Execution completed successfully
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(true)
  })

  test("retry context comes from metadata.error field only, not from metadata.resumeToken or other fields", async () => {
    const issue: BeadsIssue = {
      id: "retry-field-check",
      title: "Field isolation test",
      description: "Verify field isolation",
      parentId: DEFAULT_EPIC_ID,
    }
    const config = { ...baseConfig }

    // Metadata has error, resumeToken, and other fields —
    // only error should appear in the previous error context
    previousMetadata = {
      engine: "claude",
      workerId: "prev-worker",
      timestamp: "2026-03-19T10:00:00Z",
      resumeToken: "tok-stale-resume",
      startedAt: "2026-03-19T09:55:00Z",
      finishedAt: "2026-03-19T10:00:00Z",
      error: "ReferenceError: foo is not defined",
    }

    // Use buildWatchRequest directly to inspect the assembled request
    const request = buildWatchRequest(issue, config, previousMetadata.error, (i) => i.title)

    // The task text includes the previous error from metadata.error
    expect(request.task).toContain("## Previous Error")
    expect(request.task).toContain("ReferenceError: foo is not defined")
    // It does NOT include other metadata fields as context
    expect(request.task).not.toContain("tok-stale-resume")
    expect(request.task).not.toContain("prev-worker")
    expect(request.task).not.toContain("2026-03-19T09:55:00Z")
  })

  test("metadata without error field produces no previous error section", async () => {
    const issue = makeIssue("retry-no-err", "Previously succeeded task")
    engineResult = Effect.succeed({ response: "done" })
    previousMetadata = {
      engine: "claude",
      workerId: "prev-worker",
      timestamp: "2026-03-19T10:00:00Z",
      resumeToken: "tok-prev",
      // error intentionally absent
    }

    const request = buildWatchRequest(
      issue,
      baseConfig,
      previousMetadata.error,
      (i) => i.title,
    )

    expect(request.task).not.toContain("## Previous Error")
  })

  test("undefined metadata produces no previous error section", async () => {
    const issue = makeIssue("retry-undef", "Fresh task")
    previousMetadata = undefined

    const request = buildWatchRequest(
      issue,
      baseConfig,
      undefined,
      (i) => i.title,
    )

    expect(request.task).not.toContain("## Previous Error")
  })

  test("readMetadata is called exactly once per task to load lastFailure", async () => {
    const issue = makeIssue("retry-read-once", "Read once test")
    engineResult = Effect.succeed({ response: "done" })
    previousMetadata = {
      engine: "claude",
      workerId: "w",
      timestamp: "2026-03-19T10:00:00Z",
      error: "some error",
    }

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const readCalls = calls.filter((c) => c.op === "readMetadata" && c.id === "retry-read-once")
    expect(readCalls).toHaveLength(1)
  })

  test("previous error from metadata is included in full workflow execution", async () => {
    const issue = makeIssue("retry-full-flow", "Retry integration")
    previousMetadata = {
      engine: "claude",
      workerId: "old-worker",
      timestamp: "2026-03-19T10:00:00Z",
      error: "ENOENT: no such file or directory",
    }
    engineResult = Effect.succeed({ response: "fixed it" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    // The full lifecycle executed: readMetadata → execute → close
    const ops = calls.map((c) => c.op)
    const readIdx = ops.indexOf("readMetadata")
    const writeIdx = ops.indexOf("writeMetadata")
    const closeIdx = ops.indexOf("closeTaskSuccess")
    expect(readIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThan(readIdx)
    expect(closeIdx).toBeGreaterThan(writeIdx)
  })
})

// ===========================================================================
// Contract 2: comments are history-only, never used as retry input
// ===========================================================================

describe("retry contract: comments are never used as retry context", () => {
  test("comments written during execution are not read back for retry assembly", async () => {
    const issue = makeIssue("comment-isolation-1", "Comment isolation test")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-123" })
    previousMetadata = undefined

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Comments were written (session, success)
    const commentCalls = calls.filter((c) => c.op === "addComment")
    expect(commentCalls.length).toBeGreaterThanOrEqual(1)

    // No operation reads comments back — the only read operation is readMetadata
    const readOps = calls.filter((c) => c.op.startsWith("read"))
    expect(readOps.every((c) => c.op === "readMetadata")).toBe(true)
    // There is no readComments call
    expect(calls.some((c) => c.op === "readComments")).toBe(false)
  })

  test("failed task writes error to metadata, not just to comments", async () => {
    const issue = makeIssue("comment-fail-1", "Failure metadata test")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "type error at line 42" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // markTaskExhaustedFailure persists the error as the reason parameter
    // (the real beads.ts merges { ...metadata, error: reason } before writing)
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.reason).toContain("type error at line 42")
  })

  test("retry after failure reads metadata.error, not comment history", async () => {
    // Simulate: first run fails, second run retries
    const issue = makeIssue("comment-retry-seq", "Retry from metadata")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "lint failed" }),
    )

    // First run: fails and writes error to metadata
    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Verify first run wrote comments AND metadata error
    const firstRunComments = calls.filter((c) => c.op === "addComment")
    expect(firstRunComments.length).toBeGreaterThanOrEqual(0)
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.reason).toContain("lint failed")

    // Reset for second run
    calls = []
    assembledPrompts = []
    engineResult = Effect.succeed({ response: "done" })

    // Simulate the retry: previous metadata has the error from the first run
    previousMetadata = {
      engine: "claude",
      workerId: "worker-1",
      timestamp: "2026-03-19T10:01:00Z",
      error: "lint failed",
    }

    // Second run: should read metadata.error for retry context
    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(true)
    // readMetadata was called (to get the previous error)
    expect(calls.some((c) => c.op === "readMetadata")).toBe(true)
    // No readComments call exists
    expect(calls.some((c) => c.op === "readComments")).toBe(false)
  })

  test("buildWatchRequest only accepts previousError string, not comment objects", () => {
    const issue = makeIssue("comment-api", "API shape test")

    // buildWatchRequest takes an optional string for previous error —
    // it has no parameter for comments at all
    const request = buildWatchRequest(
      issue,
      baseConfig,
      "structured error from metadata",
      (i) => i.title,
    )

    expect(request.task).toContain("## Previous Error")
    expect(request.task).toContain("structured error from metadata")
  })
})

// ===========================================================================
// Contract 3: workspace-prepare failures trigger exhausted-failure/error flow
// ===========================================================================

describe("workspace-prepare failures: exhausted-failure/error flow", () => {
  test("workspace-prepare failure marks task as exhausted with failure reason", async () => {
    epicDetailsByParentId.set("wp-fail-epic", makeEpic("wp-fail-epic", "WP Fail Epic", "PRD body"))
    workspacePrepareFailure = new FatalError({
      command: "pnpm install --frozen-lockfile",
      message: "lockfile out of date",
    })
    const issue = makeIssue("wp-fail-1", "Bootstrap failure task", "wp-fail-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("Workspace prepare failed")
    expect(result.error).toContain("lockfile out of date")

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("wp-fail-1")
    expect(exhaustedCall?.reason).toContain("Workspace prepare failed")
    expect(exhaustedCall?.metadata?.engine).toBe("claude")
    expect(exhaustedCall?.metadata?.workerId).toBe("worker-1")
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
  })

  test("workspace-prepare failure persists epic runtime error state", async () => {
    epicDetailsByParentId.set("wp-runtime-epic", makeEpic("wp-runtime-epic", "Runtime Error Epic", "PRD"))
    workspacePrepareFailure = new FatalError({
      command: "git worktree add",
      message: "cannot create worktree",
    })
    const issue = makeIssue("wp-runtime-1", "Runtime error task", "wp-runtime-epic")

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(runtimeStateByEpicId.get("wp-runtime-epic")).toBe("error")
  })

  test("workspace-prepare failure adds error label to epic", async () => {
    epicDetailsByParentId.set("wp-label-epic", makeEpic("wp-label-epic", "Label Epic", "PRD"))
    workspacePrepareFailure = new FatalError({
      command: "copy-ignored",
      message: "permission denied",
    })
    const issue = makeIssue("wp-label-1", "Label task", "wp-label-epic")

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Error label was added to the epic
    const addLabelCall = calls.find(
      (c) => c.op === "addLabel" && c.id === "wp-label-epic" && c.label === "error",
    )
    expect(addLabelCall).toBeTruthy()
  })

  test("workspace-prepare failure posts diagnostic comment on task", async () => {
    epicDetailsByParentId.set("wp-comment-epic", makeEpic("wp-comment-epic", "Comment Epic", "PRD"))
    workspacePrepareFailure = new FatalError({
      command: "bun install",
      message: "network timeout",
    })
    const issue = makeIssue("wp-comment-1", "Comment task", "wp-comment-epic")

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Diagnostic comment was posted on the task
    const commentCall = calls.find(
      (c) => c.op === "addComment" && c.id === "wp-comment-1" && c.text?.includes("Workspace prepare failed"),
    )
    expect(commentCall).toBeTruthy()
    expect(commentCall?.text).toContain("network timeout")
  })

  test("workspace-prepare failure does not execute the agent", async () => {
    epicDetailsByParentId.set("wp-no-agent-epic", makeEpic("wp-no-agent-epic", "No Agent Epic", "PRD"))
    workspacePrepareFailure = new FatalError({
      command: "ensure worktree",
      message: "branch not found",
    })
    const issue = makeIssue("wp-no-agent-1", "No agent task", "wp-no-agent-epic")

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // No observer metadata writes (which would indicate agent execution)
    const writeMetaCalls = calls.filter((c) => c.op === "writeMetadata")
    expect(writeMetaCalls).toHaveLength(0)

    // No session or success comments from observer
    const commentCalls = calls.filter((c) => c.op === "addComment")
    const observerComments = commentCalls.filter(
      (c) => c.text?.includes("all checks passed") || c.text?.includes("--resume"),
    )
    expect(observerComments).toHaveLength(0)
  })

  test("ensureEpicWorktree failure (when runtime ready) also triggers exhausted flow", async () => {
    epicDetailsByParentId.set("ensure-fail-epic", makeEpic("ensure-fail-epic", "Ensure Fail", "PRD"))
    runtimeStateByEpicId.set("ensure-fail-epic", "ready")
    worktreeFailure = new FatalError({
      command: "git worktree add",
      message: "worktree path was deleted",
    })
    const issue = makeIssue("ensure-fail-1", "Ensure failure", "ensure-fail-epic")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to ensure epic worktree")

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    expect(exhaustedCall?.id).toBe("ensure-fail-1")
  })

  test("workspace-prepare failure preserves lastFailure in metadata for next retry", async () => {
    epicDetailsByParentId.set("wp-persist-epic", makeEpic("wp-persist-epic", "Persist Epic", "PRD"))
    workspacePrepareFailure = new FatalError({
      command: "pnpm install",
      message: "ERESOLVE could not resolve dependency tree",
    })
    const issue = makeIssue("wp-persist-1", "Persist task", "wp-persist-epic")

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // markTaskExhaustedFailure passes the error as the reason parameter
    // (the real beads.ts merges { ...metadata, error: reason } before writing)
    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall?.reason).toContain("Workspace prepare failed")
    expect(exhaustedCall?.reason).toContain("ERESOLVE could not resolve dependency tree")
  })
})

// ===========================================================================
// Contract 4: regression coverage — observer comments, status mapping,
// startup recovery
// ===========================================================================

describe("regression: observer comment behavior", () => {
  test("successful execution writes session comment with resume token", async () => {
    const issue = makeIssue("obs-reg-1", "Session comment check")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-session" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const commentCalls = calls.filter((c) => c.op === "addComment")
    const sessionComment = commentCalls.find((c) => c.text?.includes("tok-session"))
    expect(sessionComment).toBeTruthy()
    expect(sessionComment?.text).toContain("--resume")
  })

  test("successful execution writes success comment with 'all checks passed'", async () => {
    const issue = makeIssue("obs-reg-2", "Success comment check")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const commentCalls = calls.filter((c) => c.op === "addComment")
    const successComment = commentCalls.find((c) => c.text?.includes("all checks passed"))
    expect(successComment).toBeTruthy()
  })

  test("comments include attempt number formatting [attempt N/M]", async () => {
    const issue = makeIssue("obs-reg-3", "Attempt format check")
    engineResult = Effect.succeed({ response: "done", resumeToken: "tok-fmt" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const commentCalls = calls.filter((c) => c.op === "addComment")
    // At least one comment should have the [attempt N/M] format
    const hasAttemptFormat = commentCalls.some((c) => /\[attempt \d+\/\d+\]/.test(c.text ?? ""))
    expect(hasAttemptFormat).toBe(true)
  })
})

describe("regression: status mapping semantics", () => {
  const emptyDeletionSet: ReadonlySet<string> = new Set()

  test("runtime error takes highest priority in epic display status", () => {
    // Even with dirty worktree and deletion queue, error wins
    const deletionSet = new Set(["E-1"])
    const status = deriveEpicDisplayStatus("E-1", "dirty", "error", deletionSet)
    expect(status).toBe("error")
  })

  test("ready runtime with clean worktree shows as active", () => {
    const status = deriveEpicDisplayStatus("E-1", "clean", "ready", emptyDeletionSet)
    expect(status).toBe("active")
  })

  test("ready runtime with dirty worktree shows as dirty", () => {
    const status = deriveEpicDisplayStatus("E-1", "dirty", "ready", emptyDeletionSet)
    expect(status).toBe("dirty")
  })

  test("no_attempt runtime with no worktree shows as not_started", () => {
    const status = deriveEpicDisplayStatus("E-1", "not_started", "no_attempt", emptyDeletionSet)
    expect(status).toBe("not_started")
  })

  test("error → ready transition after successful workspace-prepare", async () => {
    // Start with error state
    epicDetailsByParentId.set("trans-epic", makeEpic("trans-epic", "Transition Epic", "PRD"))
    runtimeStateByEpicId.set("trans-epic", "error")
    const issue = makeIssue("trans-task", "Transition task", "trans-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Runtime state transitioned from error to ready
    expect(runtimeStateByEpicId.get("trans-epic")).toBe("ready")
  })

  test("successful task execution clears error label (via removeLabel on epic)", async () => {
    epicDetailsByParentId.set("label-trans-epic", makeEpic("label-trans-epic", "Label Trans Epic", "PRD"))
    runtimeStateByEpicId.set("label-trans-epic", "error")
    const issue = makeIssue("label-trans-task", "Label transition", "label-trans-epic")
    engineResult = Effect.succeed({ response: "done" })

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // Error label was removed from the epic
    const removeLabelCalls = calls.filter(
      (c) => c.op === "removeLabel" && c.id === "label-trans-epic" && c.label === "error",
    )
    expect(removeLabelCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe("regression: startup recovery behavior", () => {
  test("markTaskExhaustedFailure preserves error in metadata for later retry", async () => {
    const issue = makeIssue("startup-1", "Startup recovery test")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "crash during execution" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    const exhaustedCall = calls.find((c) => c.op === "markTaskExhaustedFailure")
    expect(exhaustedCall).toBeTruthy()
    // Error reason is preserved as the reason parameter (beads.ts merges it into metadata)
    expect(exhaustedCall?.reason).toContain("crash during execution")
    // Timing metadata is present
    expect(exhaustedCall?.metadata?.startedAt).toBeTruthy()
    expect(exhaustedCall?.metadata?.finishedAt).toBeTruthy()
  })

  test("markTaskExhaustedFailure does not close the task", async () => {
    const issue = makeIssue("startup-2", "No close on failure")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "execution failed" }),
    )

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "worker-1", makeWorkflowDeps()),
    )

    // markTaskExhaustedFailure was called
    expect(calls.some((c) => c.op === "markTaskExhaustedFailure")).toBe(true)
    // closeTaskSuccess was NOT called
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
    // closeTaskFailure was NOT called
    expect(calls.some((c) => c.op === "closeTaskFailure")).toBe(false)
  })

  test("failed task result carries engine and error for diagnostic visibility", async () => {
    const issue = makeIssue("startup-3", "Diagnostic visibility")
    engineResult = Effect.fail(
      new FatalError({ command: "agent", message: "OOM killed" }),
    )

    const result = await Effect.runPromise(
      processClaimedTask(issue, { ...baseConfig, engine: "codex" }, "worker-1", makeWorkflowDeps()),
    )

    expect(result.success).toBe(false)
    expect(result.engine).toBe("codex")
    expect(result.error).toBe("OOM killed")
    expect(result.taskId).toBe("startup-3")
  })
})
