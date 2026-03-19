/**
 * ABOUTME: Integration-style tests for the watch mode poll→claim→execute→close lifecycle.
 * Uses Bun module mocks to stub the beads and runTask boundaries, verifying
 * externally observable behavior without touching the filesystem or bd CLI.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test"
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

// Track all calls to beads operations in order
let calls: Array<{
  op: string
  id?: string
  reason?: string
  metadata?: BeadsMetadata
}> = []

// Track runTask invocations
let runTaskCalls: Array<{ prompt: string }> = []

// Control whether queryReady is one-shot (returns queue then empty)
let readyOneShot = true

// ---------------------------------------------------------------------------
// Module mocks — intercept the beads and runTask boundaries
// ---------------------------------------------------------------------------

mock.module("../src/beads.js", () => ({
  queryReady: () =>
    Effect.succeed((() => {
      calls.push({ op: "queryReady" })
      const result = [...readyQueue]
      if (readyOneShot) readyQueue = []
      return result
    })()),

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
}))

mock.module("../src/runTask.js", () => ({
  runTask: (prompt: string, _config: unknown, _opts?: unknown) => {
    runTaskCalls.push({ prompt })
    if (taskExecutionDelay > 0) {
      return Effect.promise(
        () => new Promise<TaskResult>((resolve) => setTimeout(() => resolve(taskResult), taskExecutionDelay)),
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

// Re-import after mocking
const { startTuiWorker } = await import("../src/tuiWorker.js")

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
  calls = []
  runTaskCalls = []
})

// ===========================================================================
// Test suites
// ===========================================================================

describe("watch lifecycle: ready → claim → execute → close", () => {
  test("successful task goes through full lifecycle", async () => {
    const issue = makeIssue("task-1", "Implement feature X")
    readyQueue = [issue]
    claimResults.set("task-1", true)
    taskResult = { success: true, engine: "claude", resumeToken: "tok-abc" }

    const { callbacks, logs, states } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-lifecycle",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess"))
    worker.stop()

    // Verify operation ordering
    const ops = calls.map((c) => c.op)
    expect(ops).toContain("recoverStaleTasks")
    expect(ops).toContain("queryReady")
    expect(ops).toContain("claimTask")
    expect(ops).toContain("writeMetadata")
    expect(ops).toContain("closeTaskSuccess")

    // Verify claim was for the right task
    const claimCall = calls.find((c) => c.op === "claimTask")
    expect(claimCall?.id).toBe("task-1")

    // Verify close was for the right task
    const closeCall = calls.find((c) => c.op === "closeTaskSuccess")
    expect(closeCall?.id).toBe("task-1")

    // Verify runTask was invoked with built prompt
    expect(runTaskCalls.length).toBe(1)
    expect(runTaskCalls[0]!.prompt).toContain("Implement feature X")

    // Verify state transitions: should go idle → running → idle
    expect(states.some((s) => s.state === "running" && s.currentTaskId === "task-1")).toBe(true)
    expect(states[states.length - 1]?.state).toBe("idle")

    // Verify writeMetadata was called twice (start + final)
    const metaCalls = calls.filter((c) => c.op === "writeMetadata" && c.id === "task-1")
    expect(metaCalls.length).toBe(2)
  })

  test("failed task is closed with failure reason", async () => {
    readyQueue = [makeIssue("task-2")]
    claimResults.set("task-2", true)
    taskResult = { success: false, engine: "claude", error: "checks failed" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-failure",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskFailure"))
    worker.stop()

    const closeCall = calls.find((c) => c.op === "closeTaskFailure")
    expect(closeCall?.id).toBe("task-2")
    expect(closeCall?.reason).toContain("checks failed")

    // Should NOT have a success close
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
  })

  test("multiple tasks are processed sequentially", async () => {
    const issue1 = makeIssue("seq-1", "First task")
    const issue2 = makeIssue("seq-2", "Second task")

    // First poll returns issue1, after it's consumed the next poll will
    // pick up issue2. We simulate this by populating the queue after
    // the first task completes.
    readyQueue = [issue1]
    readyOneShot = true
    claimResults.set("seq-1", true)
    claimResults.set("seq-2", true)
    taskResult = { success: true, engine: "claude" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-sequential",
    })

    // Wait for first task to complete
    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "seq-1"))

    // Enqueue second task
    readyQueue = [issue2]

    // Wait for second task to complete
    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "seq-2"))
    worker.stop()

    // Both tasks should have been claimed and closed
    const claimedIds = calls.filter((c) => c.op === "claimTask").map((c) => c.id)
    expect(claimedIds).toContain("seq-1")
    expect(claimedIds).toContain("seq-2")

    // Verify sequential ordering: seq-1 close must come before seq-2 claim
    const seq1CloseIdx = calls.findIndex((c) => c.op === "closeTaskSuccess" && c.id === "seq-1")
    const seq2ClaimIdx = calls.findIndex((c) => c.op === "claimTask" && c.id === "seq-2")
    expect(seq1CloseIdx).toBeLessThan(seq2ClaimIdx)
  })
})

describe("watch lifecycle: single-worker no-concurrency guarantee", () => {
  test("only one task executes at a time", async () => {
    readyQueue = [makeIssue("conc-1")]
    claimResults.set("conc-1", true)
    taskExecutionDelay = 100 // Slow task to observe serialization
    taskResult = { success: true, engine: "claude" }

    const { callbacks, states } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-concurrency",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess"))
    worker.stop()

    // Count how many times we entered "running" state
    const runningStates = states.filter((s) => s.state === "running")
    // Each running state should have exactly one taskId
    for (const s of runningStates) {
      expect(s.currentTaskId).toBeTruthy()
    }

    // runTask should have been called exactly once
    expect(runTaskCalls.length).toBe(1)
  })

  test("claim contention causes skip, not concurrent execution", async () => {
    readyQueue = [makeIssue("contend-1")]
    claimResults.set("contend-1", false) // Another worker claimed it
    readyOneShot = true

    const { callbacks, logs } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-contention",
    })

    // Wait for the claim attempt
    await waitFor(() => calls.some((c) => c.op === "claimTask"))
    // Give the worker a moment to process the result
    await new Promise((r) => setTimeout(r, 100))
    worker.stop()

    // Claim was attempted
    const claimCall = calls.find((c) => c.op === "claimTask")
    expect(claimCall?.id).toBe("contend-1")

    // runTask should NOT have been called
    expect(runTaskCalls.length).toBe(0)

    // No close call should have been made
    expect(calls.some((c) => c.op === "closeTaskSuccess")).toBe(false)
    expect(calls.some((c) => c.op === "closeTaskFailure")).toBe(false)

    // Log should mention skipping
    expect(logs.some((l) => l.message.includes("already claimed"))).toBe(true)
  })
})

describe("watch lifecycle: completed tasks are not re-run", () => {
  test("task already closed does not appear in ready queue again", async () => {
    const issue = makeIssue("once-1")
    readyQueue = [issue]
    readyOneShot = true // After first poll, queue is empty
    claimResults.set("once-1", true)
    taskResult = { success: true, engine: "claude" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-rerun",
    })

    // Wait for completion
    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "once-1"))

    // Let it poll a few more times (with empty queue)
    await new Promise((r) => setTimeout(r, 150))
    worker.stop()

    // Task should have been claimed exactly once
    const claimCalls = calls.filter((c) => c.op === "claimTask" && c.id === "once-1")
    expect(claimCalls.length).toBe(1)

    // runTask called exactly once
    expect(runTaskCalls.length).toBe(1)

    // closeTaskSuccess called exactly once for this task
    const closeCalls = calls.filter((c) => c.op === "closeTaskSuccess" && c.id === "once-1")
    expect(closeCalls.length).toBe(1)
  })

  test("ready queue returning same task ID is claimed again (Beads controls re-run)", async () => {
    // If Beads re-surfaces a task, the watcher will try to claim and run it.
    // This tests that the watcher doesn't internally track "already done" — it
    // relies on Beads to exclude completed tasks from the ready queue.
    const issue = makeIssue("resurface-1")
    readyQueue = [issue]
    readyOneShot = false // Keeps returning the same task
    claimResults.set("resurface-1", true)
    taskResult = { success: true, engine: "claude" }

    let closeCount = 0
    const origCallbacks = makeCallbacks()
    const callbacks: TuiWorkerCallbacks = {
      ...origCallbacks.callbacks,
      onTaskComplete: () => {
        closeCount++
        if (closeCount >= 2) {
          readyQueue = [] // Stop after 2 runs
        }
      },
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-resurface",
    })

    await waitFor(() => closeCount >= 2)
    worker.stop()

    // Should have claimed the task at least twice
    const claimCalls = calls.filter((c) => c.op === "claimTask" && c.id === "resurface-1")
    expect(claimCalls.length).toBeGreaterThanOrEqual(2)
  })
})

describe("watch lifecycle: failed tasks remain failed", () => {
  test("failed task is not re-polled if Beads excludes it from ready", async () => {
    readyQueue = [makeIssue("fail-1")]
    readyOneShot = true // After first poll, queue is empty (Beads hides failed tasks)
    claimResults.set("fail-1", true)
    taskResult = { success: false, engine: "claude", error: "syntax error in generated code" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-fail-stays",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskFailure" && c.id === "fail-1"))

    // Let it poll a few more times
    await new Promise((r) => setTimeout(r, 150))
    worker.stop()

    // Failure close called exactly once
    const failCalls = calls.filter((c) => c.op === "closeTaskFailure" && c.id === "fail-1")
    expect(failCalls.length).toBe(1)
    expect(failCalls[0]!.reason).toContain("syntax error")

    // No success close
    expect(calls.some((c) => c.op === "closeTaskSuccess" && c.id === "fail-1")).toBe(false)

    // runTask called exactly once
    expect(runTaskCalls.length).toBe(1)
  })

  test("failure reason includes the error from task result", async () => {
    readyQueue = [makeIssue("fail-reason-1")]
    claimResults.set("fail-reason-1", true)
    taskResult = { success: false, engine: "codex", error: "insufficient payload: missing design field" }

    const { callbacks, logs } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-fail-reason",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskFailure"))
    worker.stop()

    const closeCall = calls.find((c) => c.op === "closeTaskFailure")
    expect(closeCall?.reason).toContain("insufficient payload")

    // Log should contain failure info
    expect(logs.some((l) => l.message.includes("failed"))).toBe(true)
  })

  test("task with no error message uses default failure reason", async () => {
    readyQueue = [makeIssue("fail-default-1")]
    claimResults.set("fail-default-1", true)
    taskResult = { success: false, engine: "claude" } // No error field

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-fail-default",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskFailure"))
    worker.stop()

    const closeCall = calls.find((c) => c.op === "closeTaskFailure")
    expect(closeCall?.reason).toContain("execution failed")
  })
})

describe("watch lifecycle: metadata and operation ordering", () => {
  test("writeMetadata is called before and after execution", async () => {
    readyQueue = [makeIssue("meta-1")]
    claimResults.set("meta-1", true)
    taskResult = { success: true, engine: "claude", resumeToken: "tok-final" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-metadata-order",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess"))
    worker.stop()

    // Two writeMetadata calls for this task
    const metaCalls = calls.filter((c) => c.op === "writeMetadata" && c.id === "meta-1")
    expect(metaCalls.length).toBe(2)

    // First metadata (start): has workerId, no resumeToken
    const startMeta = metaCalls[0]!.metadata!
    expect(startMeta.workerId).toBe("test-metadata-order")
    expect(startMeta.engine).toBe("claude")

    // Final metadata: has resumeToken
    const finalMeta = metaCalls[1]!.metadata!
    expect(finalMeta.resumeToken).toBe("tok-final")
    expect(finalMeta.workerId).toBe("test-metadata-order")

    // Ordering: claim → startMeta → finalMeta → close
    const claimIdx = calls.findIndex((c) => c.op === "claimTask" && c.id === "meta-1")
    const startMetaIdx = calls.indexOf(metaCalls[0]!)
    const finalMetaIdx = calls.indexOf(metaCalls[1]!)
    const closeIdx = calls.findIndex((c) => c.op === "closeTaskSuccess" && c.id === "meta-1")

    expect(claimIdx).toBeLessThan(startMetaIdx)
    expect(startMetaIdx).toBeLessThan(finalMetaIdx)
    expect(finalMetaIdx).toBeLessThan(closeIdx)
  })

  test("stale task recovery runs before polling starts", async () => {
    readyQueue = []

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-order",
    })

    // Wait for at least one poll
    await waitFor(() => calls.filter((c) => c.op === "queryReady").length >= 1)
    worker.stop()

    // recoverStaleTasks should come before any queryReady
    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const firstPollIdx = calls.findIndex((c) => c.op === "queryReady")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(firstPollIdx).toBeGreaterThan(recoveryIdx)
  })
})

describe("watch lifecycle: callback behavior", () => {
  test("onTaskComplete callback fires for each completed task", async () => {
    readyQueue = [makeIssue("cb-1")]
    claimResults.set("cb-1", true)
    readyOneShot = true
    taskResult = { success: true, engine: "claude" }

    const helpers = makeCallbacks()
    const worker = startTuiWorker(helpers.callbacks, {
      pollIntervalMs: 30,
      workerId: "test-callback",
    })

    await waitFor(() => calls.some((c) => c.op === "closeTaskSuccess" && c.id === "cb-1"))
    // Give a tick for the callback to fire
    await new Promise((r) => setTimeout(r, 50))
    worker.stop()

    expect(helpers.taskCompleteCount).toBeGreaterThanOrEqual(1)
  })
})

describe("watch lifecycle: prompt building", () => {
  test("prompt includes issue title and description", async () => {
    readyQueue = [{
      id: "prompt-1",
      title: "Add user authentication",
      description: "Implement OAuth2 login flow",
      design: "Use passport.js middleware",
      acceptance_criteria: "- [ ] Login works\n- [ ] Logout works",
      notes: "Non-goal: social login",
    }]
    claimResults.set("prompt-1", true)
    taskResult = { success: true, engine: "claude" }

    const { callbacks } = makeCallbacks()
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-prompt",
    })

    await waitFor(() => runTaskCalls.length >= 1)
    worker.stop()

    const prompt = runTaskCalls[0]!.prompt
    expect(prompt).toContain("Add user authentication")
    expect(prompt).toContain("Implement OAuth2 login flow")
  })
})
