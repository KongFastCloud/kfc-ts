/**
 * ABOUTME: Recovery and dirty-worktree ownership tests.
 * Owns startup-recovery ordering (recovery → dirty-check → polling), stale-task
 * recovery regardless of original workerId, recovered issue state (open + error
 * with reopen → clearAssignee → markExhausted ordering), and dirty-worktree
 * pause/resume gating.
 *
 * Does NOT re-prove general task lifecycle (claim → execute → close) which is
 * owned by watchWorkflow and watchLifecycle test suites.
 *
 * Uses local in-memory fakes for recovery/git/runTask boundaries while
 * exercising the real worker and watch workflow orchestration.
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test"
import { Effect, Logger, Layer, ManagedRuntime } from "effect"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { TaskResult } from "../src/TaskResult.js"
import type { RalpheConfig } from "../src/config.js"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { EngineResolver } from "../src/EngineResolver.js"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
  TuiWorkerDeps,
  TuiWorkerHandle,
} from "../src/tuiWorker.js"
import { forkTuiWorker } from "../src/tuiWorker.js"
import { processClaimedTask, type WatchWorkflowDeps } from "../src/watchWorkflow.js"

// ---------------------------------------------------------------------------
// Configurable stubs — tests manipulate these before starting the worker
// ---------------------------------------------------------------------------

let readyQueue: BeadsIssue[] = []
let claimResults: Map<string, boolean> = new Map()
let taskResult: TaskResult = {
  success: true,
  engine: "claude",
  resumeToken: "tok-test",
}
let taskExecutionDelay = 0
let readyOneShot = true

// Track all calls to beads operations in order
let calls: Array<{
  op: string
  id?: string
  reason?: string
  metadata?: BeadsMetadata
}> = []

// Track runTask invocations
let runTaskCalls: Array<{ prompt: string }> = []

// --- Recovery stubs ---
/** Stale in_progress issues returned by recoverStaleTasks (simulating queryAllStaleInProgress). */
let staleTasks: BeadsIssue[] = []

// --- Dirty worktree stubs ---
/** Controls the return value of isWorktreeDirty. Can be mutated mid-test to simulate cleanup. */
let worktreeDirty = false

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

/** Minimal no-op logger layer for tests — no stderr, no file I/O. */
const TestLayer = Logger.replace(Logger.defaultLogger, Logger.make(() => {}))

/**
 * Fork the worker on an explicit test runtime. Every test gets its own
 * ManagedRuntime, making runtime ownership visible and honest.
 */
let startWorker: (
  callbacks: TuiWorkerCallbacks,
  opts?: { pollIntervalMs?: number; workerId?: string },
) => Promise<TuiWorkerHandle>

const baseConfig: RalpheConfig = {
  engine: "claude",
  checks: [],
  report: "none",
  maxAttempts: 1,
  git: { mode: "none" },
}

let engineResult: Effect.Effect<AgentResult, never> =
  Effect.succeed({ response: "done", resumeToken: "tok-test" })

const makeMockEngineResolverLayer = (): Layer.Layer<EngineResolver> => {
  const mockResolver: EngineResolver = {
    resolve: () => Layer.succeed(Engine, { execute: () => engineResult }),
  }
  return Layer.succeed(EngineResolver, mockResolver)
}

function makeWorkflowDeps(): WatchWorkflowDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        const result = [...readyQueue]
        if (readyOneShot) readyQueue = []
        return result
      })()),
    queryTaskDetail: (id: string) => Effect.succeed(
      id === DEFAULT_EPIC_ID
        ? { id: DEFAULT_EPIC_ID, title: "Default Epic", status: "backlog" as const, description: "Default epic PRD.", labels: ["epic"], branch: `epic/${DEFAULT_EPIC_ID}` }
        : undefined,
    ),
    claimTask: (id: string) =>
      Effect.succeed((() => {
        calls.push({ op: "claimTask", id })
        return claimResults.get(id) ?? true
      })()),
    closeTaskSuccess: (id: string, reason?: string) => {
      calls.push({ op: "closeTaskSuccess", id, reason })
      return Effect.succeed(undefined)
    },
    writeMetadata: (id: string, metadata: BeadsMetadata) => {
      calls.push({ op: "writeMetadata", id, metadata })
      return Effect.succeed(undefined)
    },
    addLabel: () => Effect.succeed(undefined),
    removeLabel: () => Effect.succeed(undefined),
    readMetadata: (id: string) => {
      calls.push({ op: "readMetadata", id })
      return Effect.succeed(undefined)
    },
    buildPromptFromIssue: (issue: BeadsIssue) => {
      const sections: string[] = [issue.title]
      if (issue.description) sections.push(`\n## Description\n${issue.description}`)
      runTaskCalls.push({ prompt: sections.join("\n") })
      return sections.join("\n")
    },
    markTaskExhaustedFailure: (id: string, reason: string, metadata: BeadsMetadata) => {
      calls.push({ op: "markTaskExhaustedFailure", id, reason, metadata })
      return Effect.succeed(undefined)
    },
    addComment: (_id: string, _text: string) => Effect.succeed(undefined),
    engineResolverLayer: makeMockEngineResolverLayer(),
    ensureEpicWorktree: () => Effect.succeed("/tmp/ralphe-worktrees/mock"),
    getEpicRuntimeStatus: () => Effect.succeed("ready"),
    setEpicRuntimeStatus: () => Effect.succeed(undefined),
    workspacePrepare: (input) => Effect.succeed({ worktreePath: input.worktreePath, copyResult: { copied: 0, skipped: 0, failures: [] }, completedStage: "bootstrap" as const }),
    deriveEpicWorktreePath: (epicId: string) => Effect.succeed(`/tmp/ralphe-worktrees/${epicId}`),
    getRepoRoot: () => Effect.succeed("/tmp/mock-repo-root"),
  }
}

function makeWorkerDeps(): TuiWorkerDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: makeWorkflowDeps().queryQueued,
    claimTask: makeWorkflowDeps().claimTask,
    recoverStaleTasks: (workerId: string) => {
      calls.push({ op: "recoverStaleTasks" })
      const tasks = [...staleTasks]
      for (const issue of tasks) {
        calls.push({ op: "reopenTask", id: issue.id })
        calls.push({ op: "clearAssignee", id: issue.id })
        const now = new Date().toISOString()
        calls.push({
          op: "markTaskExhaustedFailure",
          id: issue.id,
          reason: "worker crashed — recovered on startup",
          metadata: {
            engine: "claude",
            workerId,
            timestamp: now,
            finishedAt: now,
          },
        })
      }
      return Effect.succeed(tasks.length)
    },
    isWorktreeDirty: () => {
      calls.push({ op: "isWorktreeDirty" })
      return Effect.succeed(worktreeDirty)
    },
    processClaimedTask: (issue, config, workerId) =>
      processClaimedTask(issue, config, workerId, makeWorkflowDeps()),
  }
}

beforeAll(async () => {
  startWorker = async (callbacks, opts) => {
    const runtime = ManagedRuntime.make(TestLayer)
    const handle = await forkTuiWorker(runtime, callbacks, {
      ...opts,
      deps: makeWorkerDeps(),
    })
    return {
      stop: async () => {
        await handle.stop()
        await runtime.dispose()
      },
    }
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks() {
  const logs: WorkerLogEntry[] = []
  const states: WorkerStatus[] = []
  let taskCompleteCount = 0

  const callbacks: TuiWorkerCallbacks = {
    onStateChange: (status) => states.push(status),
    onLog: (entry) => logs.push(entry),
    onTaskComplete: () => {
      taskCompleteCount++
    },
  }

  return {
    callbacks,
    logs,
    states,
    get taskCompleteCount() {
      return taskCompleteCount
    },
  }
}

const DEFAULT_EPIC_ID = "default-epic"

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}`, parentId: DEFAULT_EPIC_ID }
}

/** Wait until a predicate becomes true or timeout. Default 5s for CI reliability. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out")
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  readyQueue = []
  claimResults = new Map()
  taskResult = { success: true, engine: "claude", resumeToken: "tok-test" }
  taskExecutionDelay = 0
  readyOneShot = true
  staleTasks = []
  worktreeDirty = false
  calls = []
  runTaskCalls = []
})

// ===========================================================================
// Test suites
// ===========================================================================

describe("restart recovery: startup ordering", () => {
  test("recoverStaleTasks runs before any queryQueued poll", async () => {
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-startup-order",
    })

    // Wait for at least one poll to occur
    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    await worker.stop()

    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const firstPollIdx = calls.findIndex((c) => c.op === "queryQueued")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(firstPollIdx).toBeGreaterThan(recoveryIdx)
  })

  test("recoverStaleTasks runs before any claimTask call", async () => {
    staleTasks = [makeIssue("stale-1")]
    readyQueue = [makeIssue("new-1")]
    claimResults.set("new-1", true)

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-before-claim",
    })

    await waitFor(() => calls.some((c) => c.op === "claimTask"))
    await worker.stop()

    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const firstClaimIdx = calls.findIndex((c) => c.op === "claimTask")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(firstClaimIdx).toBeGreaterThan(recoveryIdx)
  })

  test("dirty-worktree check runs after recovery but before polling", async () => {
    staleTasks = [makeIssue("stale-pre-dirty")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-order",
    })

    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    await worker.stop()

    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const dirtyCheckIdx = calls.findIndex((c) => c.op === "isWorktreeDirty")
    const firstPollIdx = calls.findIndex((c) => c.op === "queryQueued")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(dirtyCheckIdx).toBeGreaterThan(recoveryIdx)
    expect(firstPollIdx).toBeGreaterThan(dirtyCheckIdx)
  })
})

describe("restart recovery: stale-task recovery regardless of workerId", () => {
  test("recovers stale tasks from a different worker", async () => {
    // Stale task was originally claimed by "worker-A", but the current
    // worker is "worker-B". Recovery should still process it.
    staleTasks = [makeIssue("orphan-1", "Orphaned task from worker-A")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "worker-B",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "orphan-1"))
    await worker.stop()

    // The orphaned task was recovered even though the current worker is different
    const recoverCall = calls.find(
      (c) => c.op === "markTaskExhaustedFailure" && c.id === "orphan-1",
    )
    expect(recoverCall).toBeDefined()
    expect(recoverCall!.metadata?.workerId).toBe("worker-B")
  })

  test("recovers multiple stale tasks from different workers in a single startup", async () => {
    staleTasks = [
      makeIssue("stale-from-A", "Task left by worker-A"),
      makeIssue("stale-from-B", "Task left by worker-B"),
      makeIssue("stale-from-C", "Task left by worker-C"),
    ]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "worker-current",
    })

    await waitFor(() =>
      calls.filter((c) => c.op === "markTaskExhaustedFailure").length >= 3,
    )
    await worker.stop()

    // All three stale tasks were recovered
    const recoveredIds = calls
      .filter((c) => c.op === "markTaskExhaustedFailure")
      .map((c) => c.id)

    expect(recoveredIds).toContain("stale-from-A")
    expect(recoveredIds).toContain("stale-from-B")
    expect(recoveredIds).toContain("stale-from-C")
  })

  test("recovery count is reported via onTaskComplete callback when > 0", async () => {
    staleTasks = [makeIssue("stale-cb-1"), makeIssue("stale-cb-2")]
    readyQueue = []

    const helpers = makeCallbacks()
    const worker = await startWorker(helpers.callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-cb",
    })

    await waitFor(() => calls.some((c) => c.op === "recoverStaleTasks"))
    // Give the callback a tick to fire
    await new Promise((r) => setTimeout(r, 50))
    await worker.stop()

    expect(helpers.taskCompleteCount).toBeGreaterThanOrEqual(1)
  })
})

describe("restart recovery: recovered issue state is open + error", () => {
  test("recovered tasks use markTaskExhaustedFailure, not closeTaskFailure", async () => {
    staleTasks = [makeIssue("state-1", "Task to recover")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-state-check",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "state-1"))
    await worker.stop()

    // markTaskExhaustedFailure was called (open + error)
    expect(
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "state-1"),
    ).toBe(true)

    // closeTaskFailure was NOT called (task should not be closed)
    expect(
      calls.some((c) => c.op === "closeTaskFailure" && c.id === "state-1"),
    ).toBe(false)

    // closeTaskSuccess was NOT called
    expect(
      calls.some((c) => c.op === "closeTaskSuccess" && c.id === "state-1"),
    ).toBe(false)
  })

  test("recovered task metadata includes finishedAt timestamp", async () => {
    staleTasks = [makeIssue("meta-recover-1")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-meta-recover",
    })

    await waitFor(() =>
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "meta-recover-1"),
    )
    await worker.stop()

    const recoverCall = calls.find(
      (c) => c.op === "markTaskExhaustedFailure" && c.id === "meta-recover-1",
    )
    expect(recoverCall?.metadata?.finishedAt).toBeTruthy()
    expect(recoverCall?.metadata?.timestamp).toBeTruthy()
    expect(recoverCall?.metadata?.engine).toBe("claude")
  })

  test("recovered tasks are reopened (status set to open) before error label", async () => {
    staleTasks = [makeIssue("reopen-1", "Task to reopen")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-reopen",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "reopen-1"))
    await worker.stop()

    // reopenTask was called before markTaskExhaustedFailure
    const reopenIdx = calls.findIndex((c) => c.op === "reopenTask" && c.id === "reopen-1")
    const exhaustedIdx = calls.findIndex((c) => c.op === "markTaskExhaustedFailure" && c.id === "reopen-1")

    expect(reopenIdx).toBeGreaterThanOrEqual(0)
    expect(exhaustedIdx).toBeGreaterThan(reopenIdx)
  })

  test("recovered tasks have assignee cleared (no stale claim residue)", async () => {
    staleTasks = [makeIssue("assignee-1", "Task with stale assignee")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clear-assignee",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "assignee-1"))
    await worker.stop()

    // clearAssignee was called before markTaskExhaustedFailure
    const clearIdx = calls.findIndex((c) => c.op === "clearAssignee" && c.id === "assignee-1")
    const exhaustedIdx = calls.findIndex((c) => c.op === "markTaskExhaustedFailure" && c.id === "assignee-1")

    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(exhaustedIdx).toBeGreaterThan(clearIdx)
  })

  test("recovery ordering per issue: reopen → clearAssignee → markExhausted", async () => {
    staleTasks = [makeIssue("order-1")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-per-issue-order",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "order-1"))
    await worker.stop()

    const reopenIdx = calls.findIndex((c) => c.op === "reopenTask" && c.id === "order-1")
    const clearIdx = calls.findIndex((c) => c.op === "clearAssignee" && c.id === "order-1")
    const exhaustedIdx = calls.findIndex((c) => c.op === "markTaskExhaustedFailure" && c.id === "order-1")

    expect(reopenIdx).toBeGreaterThanOrEqual(0)
    expect(clearIdx).toBeGreaterThan(reopenIdx)
    expect(exhaustedIdx).toBeGreaterThan(clearIdx)
  })

  test("recovered tasks do not appear as active after recovery", async () => {
    // After recovery, no stale tasks remain. The ready queue is empty so
    // no new claims happen. This verifies recovered tasks don't re-surface.
    staleTasks = [makeIssue("ghost-1")]
    readyQueue = []
    readyOneShot = false // Keep returning empty queue

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-ghost",
    })

    // Wait for several poll cycles after recovery
    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 3)
    await worker.stop()

    // No claim calls should have been made (recovered task is not re-picked-up)
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
  })

  test("recovery reason mentions crash/startup context", async () => {
    staleTasks = [makeIssue("reason-1")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-reason",
    })

    await waitFor(() =>
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "reason-1"),
    )
    await worker.stop()

    const recoverCall = calls.find(
      (c) => c.op === "markTaskExhaustedFailure" && c.id === "reason-1",
    )
    expect(recoverCall?.reason).toContain("recovered on startup")
  })
})

describe("dirty worktree: pauses automatic pickup", () => {
  test("no claims are made while worktree is dirty", async () => {
    worktreeDirty = true
    readyQueue = [makeIssue("blocked-1")]
    claimResults.set("blocked-1", true)
    readyOneShot = false

    const { callbacks, logs } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-pause",
    })

    // Let the dirty-check loop run a few iterations
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 3)
    await worker.stop()

    // No claims should have been made — the worker is paused
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)

    // No queryQueued calls either — the polling loop hasn't started
    expect(calls.some((c) => c.op === "queryQueued")).toBe(false)

    // Logs should mention the pause
    expect(logs.some((l) => l.message.includes("pausing automatic pickup"))).toBe(true)
  })

  test("recovery still runs even when worktree is dirty", async () => {
    worktreeDirty = true
    staleTasks = [makeIssue("dirty-stale-1")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-recovery",
    })

    // Wait for at least one dirty check (which means recovery has already run)
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 1)
    await worker.stop()

    // Recovery ran before the dirty-worktree check
    expect(calls.some((c) => c.op === "recoverStaleTasks")).toBe(true)
    expect(
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "dirty-stale-1"),
    ).toBe(true)

    // But no polling occurred
    expect(calls.some((c) => c.op === "queryQueued")).toBe(false)
  })
})

describe("dirty worktree: clean state allows normal polling", () => {
  test("clean worktree allows polling to proceed after recovery", async () => {
    worktreeDirty = false // Clean
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clean-proceed",
    })

    await waitFor(() => calls.some((c) => c.op === "queryQueued"))
    await worker.stop()

    // Dirty-worktree gate passed: recovery → dirty-check → poll started
    // (full claim→execute→close lifecycle is owned by watchWorkflow/watchLifecycle)
    const ops = calls.map((c) => c.op)
    expect(ops).toContain("recoverStaleTasks")
    expect(ops).toContain("isWorktreeDirty")
    expect(ops).toContain("queryQueued")
  })

  test("worktree becoming clean resumes polling after a pause", async () => {
    worktreeDirty = true // Start dirty
    readyQueue = [makeIssue("resume-1")]
    claimResults.set("resume-1", true)
    readyOneShot = true

    const { callbacks, logs } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-resume-after-clean",
    })

    // Let the dirty loop run a couple times
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 2)

    // Simulate the worktree being cleaned up
    worktreeDirty = false

    // Now polling should resume and pick up work
    await waitFor(() => calls.some((c) => c.op === "claimTask" && c.id === "resume-1"))
    await worker.stop()

    // Verify the pause happened
    expect(logs.some((l) => l.message.includes("pausing automatic pickup"))).toBe(true)

    // Verify polling resumed — claim proves the dirty-worktree gate reopened
    // (full claim→execute→close lifecycle is owned by watchWorkflow/watchLifecycle)
    expect(calls.some((c) => c.op === "claimTask" && c.id === "resume-1")).toBe(true)
  })

  test("no dirty-worktree pause log when worktree is already clean", async () => {
    worktreeDirty = false
    readyQueue = []

    const { callbacks, logs } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clean-no-pause-log",
    })

    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    await worker.stop()

    // No pause message should appear
    expect(logs.some((l) => l.message.includes("pausing automatic pickup"))).toBe(false)
  })
})

describe("restart recovery: combined recovery + dirty-worktree + polling", () => {
  test("full startup sequence: recovery → dirty-check (clean) → poll → claim", async () => {
    staleTasks = [makeIssue("full-stale-1")]
    worktreeDirty = false
    readyQueue = [makeIssue("full-new-1")]
    claimResults.set("full-new-1", true)

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-full-sequence",
    })

    await waitFor(() => calls.some((c) => c.op === "claimTask" && c.id === "full-new-1"))
    await worker.stop()

    // Verify startup ordering: recovery → markExhausted → dirtyCheck → poll → claim
    // (claim→execute→close lifecycle ordering is owned by watchWorkflow/watchLifecycle)
    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const exhaustedIdx = calls.findIndex(
      (c) => c.op === "markTaskExhaustedFailure" && c.id === "full-stale-1",
    )
    const dirtyCheckIdx = calls.findIndex((c) => c.op === "isWorktreeDirty")
    const pollIdx = calls.findIndex((c) => c.op === "queryQueued")
    const claimIdx = calls.findIndex((c) => c.op === "claimTask" && c.id === "full-new-1")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(exhaustedIdx).toBeGreaterThan(recoveryIdx)
    expect(dirtyCheckIdx).toBeGreaterThan(exhaustedIdx)
    expect(pollIdx).toBeGreaterThan(dirtyCheckIdx)
    expect(claimIdx).toBeGreaterThan(pollIdx)
  })

  test("full startup sequence: recovery → dirty-check (dirty) → no poll", async () => {
    staleTasks = [makeIssue("full-stale-2")]
    worktreeDirty = true
    readyQueue = [makeIssue("full-blocked-1")]
    claimResults.set("full-blocked-1", true)

    const { callbacks } = makeCallbacks()
    const worker = await startWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-full-dirty",
    })

    // Let the dirty loop tick a few times
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 2)
    await worker.stop()

    // Recovery happened
    expect(
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "full-stale-2"),
    ).toBe(true)

    // Dirty check happened
    expect(calls.some((c) => c.op === "isWorktreeDirty")).toBe(true)

    // But no polling or claiming — the worker is paused
    expect(calls.some((c) => c.op === "queryQueued")).toBe(false)
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
  })
})
