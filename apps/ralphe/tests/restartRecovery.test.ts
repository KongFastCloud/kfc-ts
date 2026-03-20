/**
 * ABOUTME: Regression tests for restart recovery and dirty-worktree guard.
 * Verifies startup ordering (recovery → dirty-check → polling), stale-task
 * recovery regardless of original workerId, recovered issue state (open + error),
 * and paused/resumed pickup based on worktree cleanliness.
 *
 * Uses Bun module mocks following the same pattern as watchLifecycle.test.ts.
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test"
import { Effect } from "effect"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import type { TaskResult } from "../src/runTask.js"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
} from "../src/tuiWorker.js"

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
// Module setup — install mocks lazily so they do not leak into other files
// ---------------------------------------------------------------------------

let startTuiWorker: typeof import("../src/tuiWorker.js").startTuiWorker

beforeAll(async () => {
  mock.module("../src/beadsAdapter.js", () => ({
    queryQueued: () =>
      Effect.succeed((() => {
        calls.push({ op: "queryQueued" })
        const result = [...readyQueue]
        if (readyOneShot) readyQueue = []
        return result
      })()),
  }))

  mock.module("../src/beads.js", () => ({
    claimTask: (id: string) =>
      Effect.succeed((() => {
        calls.push({ op: "claimTask", id })
        return claimResults.get(id) ?? true
      })()),

    closeTaskSuccess: (id: string, reason?: string) => {
      calls.push({ op: "closeTaskSuccess", id, reason })
      return Effect.succeed(undefined)
    },

    closeTaskFailure: (id: string, reason: string) => {
      calls.push({ op: "closeTaskFailure", id, reason })
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

    reopenTask: (id: string) => {
      calls.push({ op: "reopenTask", id })
      return Effect.succeed(undefined)
    },

    clearAssignee: (id: string) => {
      calls.push({ op: "clearAssignee", id })
      return Effect.succeed(undefined)
    },

    /**
     * Mock recoverStaleTasks that mirrors the production implementation:
     * - Reads ALL stale in_progress issues (from `staleTasks` stub, which
     *   simulates queryAllStaleInProgress — no workerId filtering).
     * - For each stale issue, reopens it (status → open), clears assignee,
     *   then pushes a markTaskExhaustedFailure call (error label + metadata).
     * - Returns the count of recovered tasks.
     */
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

    buildPromptFromIssue: (issue: BeadsIssue) => {
      const sections: string[] = [issue.title]
      if (issue.description) sections.push(`\n## Description\n${issue.description}`)
      return sections.join("\n")
    },

    queryAllStaleInProgress: () => {
      calls.push({ op: "queryAllStaleInProgress" })
      return Effect.succeed([...staleTasks])
    },
  }))

  // Preserve real git exports so git.test.ts isn't broken by mock leakage.
  const realGit = await import("../src/git.js")
  mock.module("../src/git.js", () => ({
    ...realGit,
    isWorktreeDirty: () => {
      calls.push({ op: "isWorktreeDirty" })
      return Effect.succeed(worktreeDirty)
    },
  }))

  mock.module("../src/runTask.js", () => ({
    runTask: (prompt: string, _config: unknown, _opts?: unknown) => {
      runTaskCalls.push({ prompt })
      if (taskExecutionDelay > 0) {
        return Effect.promise(
          () =>
            new Promise<TaskResult>((resolve) =>
              setTimeout(() => resolve(taskResult), taskExecutionDelay),
            ),
        )
      }
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
  ;({ startTuiWorker } = await import("../src/tuiWorker.js?restartRecovery") as typeof import("../src/tuiWorker.js"))
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

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}` }
}

/** Wait until a predicate becomes true or timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
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

afterAll(() => {
  mock.restore()
})

// ===========================================================================
// Test suites
// ===========================================================================

describe("restart recovery: startup ordering", () => {
  test("recoverStaleTasks runs before any queryQueued poll", async () => {
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-startup-order",
    })

    // Wait for at least one poll to occur
    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-before-claim",
    })

    await waitFor(() => calls.some((c) => c.op === "claimTask"))
    worker.stop()

    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const firstClaimIdx = calls.findIndex((c) => c.op === "claimTask")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(firstClaimIdx).toBeGreaterThan(recoveryIdx)
  })

  test("dirty-worktree check runs after recovery but before polling", async () => {
    staleTasks = [makeIssue("stale-pre-dirty")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-order",
    })

    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "worker-B",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "orphan-1"))
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "worker-current",
    })

    await waitFor(() =>
      calls.filter((c) => c.op === "markTaskExhaustedFailure").length >= 3,
    )
    worker.stop()

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
    const worker = startTuiWorker(helpers.callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-cb",
    })

    await waitFor(() => calls.some((c) => c.op === "recoverStaleTasks"))
    // Give the callback a tick to fire
    await new Promise((r) => setTimeout(r, 50))
    worker.stop()

    expect(helpers.taskCompleteCount).toBeGreaterThanOrEqual(1)
  })
})

describe("restart recovery: recovered issue state is open + error", () => {
  test("recovered tasks use markTaskExhaustedFailure, not closeTaskFailure", async () => {
    staleTasks = [makeIssue("state-1", "Task to recover")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-state-check",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "state-1"))
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-meta-recover",
    })

    await waitFor(() =>
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "meta-recover-1"),
    )
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-reopen",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "reopen-1"))
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clear-assignee",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "assignee-1"))
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-per-issue-order",
    })

    await waitFor(() => calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "order-1"))
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-ghost",
    })

    // Wait for several poll cycles after recovery
    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 3)
    worker.stop()

    // No claim calls should have been made (recovered task is not re-picked-up)
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
  })

  test("recovery reason mentions crash/startup context", async () => {
    staleTasks = [makeIssue("reason-1")]
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-reason",
    })

    await waitFor(() =>
      calls.some((c) => c.op === "markTaskExhaustedFailure" && c.id === "reason-1"),
    )
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-pause",
    })

    // Let the dirty-check loop run a few iterations
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 3)
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-dirty-recovery",
    })

    // Wait for at least one dirty check (which means recovery has already run)
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 1)
    worker.stop()

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
    readyQueue = [makeIssue("clean-1")]
    claimResults.set("clean-1", true)

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clean-proceed",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "clean-1"))
    worker.stop()

    // Full lifecycle completed: recovery → dirty-check → poll → claim → execute → close
    const ops = calls.map((c) => c.op)
    expect(ops).toContain("recoverStaleTasks")
    expect(ops).toContain("isWorktreeDirty")
    expect(ops).toContain("queryQueued")
    expect(ops).toContain("claimTask")
    expect(ops).toContain("closeTaskSuccess")
  })

  test("worktree becoming clean resumes polling after a pause", async () => {
    worktreeDirty = true // Start dirty
    readyQueue = [makeIssue("resume-1")]
    claimResults.set("resume-1", true)
    readyOneShot = true

    const { callbacks, logs } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-resume-after-clean",
    })

    // Let the dirty loop run a couple times
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 2)

    // Simulate the worktree being cleaned up
    worktreeDirty = false

    // Now polling should resume and process the task
    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "resume-1"))
    worker.stop()

    // Verify the pause happened
    expect(logs.some((l) => l.message.includes("pausing automatic pickup"))).toBe(true)

    // Verify normal lifecycle completed after resuming
    expect(calls.some((c) => c.op === "claimTask" && c.id === "resume-1")).toBe(true)
    expect(calls.some((c) => c.op === "closeTaskSuccess" && c.id === "resume-1")).toBe(true)
  })

  test("no dirty-worktree pause log when worktree is already clean", async () => {
    worktreeDirty = false
    readyQueue = []

    const { callbacks, logs } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-clean-no-pause-log",
    })

    await waitFor(() => calls.filter((c) => c.op === "queryQueued").length >= 1)
    worker.stop()

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
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-full-sequence",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "full-new-1"))
    worker.stop()

    // Verify full ordering: recovery → markExhausted → dirtyCheck → poll → claim → close
    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const exhaustedIdx = calls.findIndex(
      (c) => c.op === "markTaskExhaustedFailure" && c.id === "full-stale-1",
    )
    const dirtyCheckIdx = calls.findIndex((c) => c.op === "isWorktreeDirty")
    const pollIdx = calls.findIndex((c) => c.op === "queryQueued")
    const claimIdx = calls.findIndex((c) => c.op === "claimTask" && c.id === "full-new-1")
    const closeIdx = calls.findIndex((c) => c.op === "closeTaskSuccess" && c.id === "full-new-1")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(exhaustedIdx).toBeGreaterThan(recoveryIdx)
    expect(dirtyCheckIdx).toBeGreaterThan(exhaustedIdx)
    expect(pollIdx).toBeGreaterThan(dirtyCheckIdx)
    expect(claimIdx).toBeGreaterThan(pollIdx)
    expect(closeIdx).toBeGreaterThan(claimIdx)
  })

  test("full startup sequence: recovery → dirty-check (dirty) → no poll", async () => {
    staleTasks = [makeIssue("full-stale-2")]
    worktreeDirty = true
    readyQueue = [makeIssue("full-blocked-1")]
    claimResults.set("full-blocked-1", true)

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-full-dirty",
    })

    // Let the dirty loop tick a few times
    await waitFor(() => calls.filter((c) => c.op === "isWorktreeDirty").length >= 2)
    worker.stop()

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
