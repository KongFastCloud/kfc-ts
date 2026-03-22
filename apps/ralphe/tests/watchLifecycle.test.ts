/**
 * ABOUTME: Worker-layer orchestration tests for watch mode.
 *
 * Proves poll-loop mechanics that are NOT covered by tuiWorker.test.ts
 * (which owns interrupt, log shape, state transitions, claim contention,
 * adapter error resilience, worker ID propagation) or watchWorkflow.test.ts
 * (which owns metadata timing, prompt building, exhausted-failure semantics).
 *
 * Owned contracts:
 *  1. Sequential execution — tasks are processed one at a time, in order
 *  2. Poll-loop correctness — stale recovery ordering, empty queue, no fallback queries
 *  3. Failure-then-recovery — worker continues accepting work after a failure
 *  4. Task routing — claimed tasks are delegated to processClaimedTask
 *  5. Re-run delegation — worker does not internally track "already done"
 *
 * Uses ManagedRuntime + forkDaemon for reliable fiber lifecycle in CI.
 * All adapter behavior is stubbed at the worker-deps boundary — no ambient
 * environment coupling.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Fiber, ManagedRuntime, Logger } from "effect"
import type { RalpheConfig } from "../src/config.js"
import { FatalError } from "../src/errors.js"
import type { ProcessTaskResult } from "../src/watchWorkflow.js"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
  TuiWorkerDeps,
  TuiWorkerOptions,
} from "../src/tuiWorker.js"
import type { BeadsIssue } from "../src/beads.js"
import { tuiWorkerEffect } from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Configurable stubs — tests set these before starting the worker
// ---------------------------------------------------------------------------

/** Tasks returned by queryQueued. Empty by default. */
let readyQueue: BeadsIssue[] = []

/** Whether queryQueued drains the queue on first call (one-shot mode). */
let readyOneShot = true

/** Per-task claim results. Defaults to true (claim succeeds). */
let claimResults: Map<string, boolean> = new Map()

/** Result returned by processClaimedTask. */
let processResult: ProcessTaskResult = {
  success: true,
  taskId: "stub-task",
  engine: "claude",
  resumeToken: "tok",
}

/** Optional delay for processClaimedTask to simulate slow execution. */
let processDelayMs = 0

/** Track all adapter operations in order for sequencing assertions. */
let calls: Array<{ op: string; id?: string }> = []

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

function makeWorkerDeps(): TuiWorkerDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () => {
      calls.push({ op: "queryQueued" })
      const result = [...readyQueue]
      if (readyOneShot) readyQueue = []
      return Effect.succeed(result)
    },
    claimTask: (id: string) => {
      calls.push({ op: "claimTask", id })
      return Effect.succeed(claimResults.get(id) ?? true)
    },
    recoverStaleTasks: () => {
      calls.push({ op: "recoverStaleTasks" })
      return Effect.succeed(0)
    },
    isWorktreeDirty: () => Effect.succeed(false),
    processClaimedTask: (issue: BeadsIssue) => {
      calls.push({ op: "processClaimedTask", id: issue.id })
      const result: ProcessTaskResult = {
        ...processResult,
        taskId: issue.id,
      }
      if (processDelayMs > 0) {
        return Effect.promise(
          () =>
            new Promise<ProcessTaskResult>((resolve) =>
              setTimeout(() => resolve(result), processDelayMs),
            ),
        )
      }
      return Effect.succeed(result)
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal layer for testing — replace default logger with no-op. */
const TestLayer = Logger.replace(Logger.defaultLogger, Logger.make(() => {}))

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}` }
}

/**
 * Fork the Effect-based worker in a managed runtime and return a handle
 * to interrupt it. Mirrors the controller's fiber-based lifecycle.
 */
async function runWorker(
  callbacks: TuiWorkerCallbacks,
  opts?: TuiWorkerOptions,
): Promise<{ interrupt: () => Promise<void> }> {
  const runtime = ManagedRuntime.make(TestLayer)
  const fiber = await runtime.runPromise(
    Effect.forkDaemon(
      tuiWorkerEffect(callbacks, { ...opts, deps: makeWorkerDeps() }),
    ),
  )
  return {
    interrupt: async () => {
      await runtime.runPromise(Fiber.interrupt(fiber))
      await runtime.dispose()
    },
  }
}

/** Build a minimal TuiWorkerCallbacks that collects logs, states, and task completions. */
function makeCollectors() {
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
    logs,
    states,
    callbacks,
    get taskCompleteCount() {
      return taskCompleteCount
    },
  }
}

/** Wait until a predicate becomes true or timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 10,
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
  readyOneShot = true
  claimResults = new Map()
  processResult = {
    success: true,
    taskId: "stub-task",
    engine: "claude",
    resumeToken: "tok",
  }
  processDelayMs = 0
  calls = []
})

// ===========================================================================
// Test suites
// ===========================================================================

describe("worker orchestration: task routing through workflow", () => {
  test("claimed task is delegated to processClaimedTask", async () => {
    readyQueue = [makeIssue("route-1", "Implement feature X")]
    claimResults.set("route-1", true)

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-routing",
    })

    await waitFor(() => calls.some((c) => c.op === "processClaimedTask"))
    await worker.interrupt()

    // Worker claimed and then delegated to processClaimedTask
    const claimCall = calls.find((c) => c.op === "claimTask")
    expect(claimCall?.id).toBe("route-1")
    const processCall = calls.find((c) => c.op === "processClaimedTask")
    expect(processCall?.id).toBe("route-1")

    // Claim must happen before process
    const claimIdx = calls.findIndex((c) => c.op === "claimTask")
    const processIdx = calls.findIndex((c) => c.op === "processClaimedTask")
    expect(claimIdx).toBeLessThan(processIdx)
  })

  test("failed task triggers onTaskComplete so UI can refresh", async () => {
    readyQueue = [makeIssue("fail-route-1")]
    claimResults.set("fail-route-1", true)
    processResult = {
      success: false,
      taskId: "fail-route-1",
      engine: "claude",
      error: "checks failed",
    }

    const collectors = makeCollectors()
    const worker = await runWorker(collectors.callbacks, {
      pollIntervalMs: 30,
      workerId: "test-fail-route",
    })

    await waitFor(() => collectors.taskCompleteCount >= 1)
    await worker.interrupt()

    // processClaimedTask was called for the right task
    expect(
      calls.some(
        (c) => c.op === "processClaimedTask" && c.id === "fail-route-1",
      ),
    ).toBe(true)
    expect(collectors.taskCompleteCount).toBeGreaterThanOrEqual(1)
  })
})

describe("worker orchestration: sequential execution", () => {
  test("multiple tasks are processed sequentially", async () => {
    readyQueue = [makeIssue("seq-1", "First task")]
    readyOneShot = true
    claimResults.set("seq-1", true)
    claimResults.set("seq-2", true)

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-sequential",
    })

    // Wait for first task to complete
    await waitFor(() =>
      calls.some((c) => c.op === "processClaimedTask" && c.id === "seq-1"),
    )

    // Enqueue second task
    readyQueue = [makeIssue("seq-2", "Second task")]

    // Wait for second task to complete
    await waitFor(() =>
      calls.some((c) => c.op === "processClaimedTask" && c.id === "seq-2"),
    )
    await worker.interrupt()

    // Both tasks were claimed and processed
    const claimedIds = calls
      .filter((c) => c.op === "claimTask")
      .map((c) => c.id)
    expect(claimedIds).toContain("seq-1")
    expect(claimedIds).toContain("seq-2")

    // seq-1 process must complete before seq-2 claim
    const seq1ProcessIdx = calls.findIndex(
      (c) => c.op === "processClaimedTask" && c.id === "seq-1",
    )
    const seq2ClaimIdx = calls.findIndex(
      (c) => c.op === "claimTask" && c.id === "seq-2",
    )
    expect(seq1ProcessIdx).toBeLessThan(seq2ClaimIdx)
  })

  test("only one task executes at a time", async () => {
    readyQueue = [makeIssue("conc-1")]
    claimResults.set("conc-1", true)
    processDelayMs = 80 // Slow task to observe serialization

    const { callbacks, states } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-concurrency",
    })

    await waitFor(() =>
      calls.some((c) => c.op === "processClaimedTask" && c.id === "conc-1"),
    )
    // Wait for it to finish (state returns to idle)
    await waitFor(() => {
      const stateNames = states.map((s) => s.state)
      const runningIdx = stateNames.indexOf("running")
      return (
        runningIdx >= 0 && stateNames.indexOf("idle", runningIdx + 1) >= 0
      )
    })
    await worker.interrupt()

    // processClaimedTask called exactly once
    const processCalls = calls.filter(
      (c) => c.op === "processClaimedTask" && c.id === "conc-1",
    )
    expect(processCalls.length).toBe(1)

    // Each running state should have exactly one taskId
    const runningStates = states.filter((s) => s.state === "running")
    for (const s of runningStates) {
      expect(s.currentTaskId).toBeTruthy()
    }
  })
})

describe("worker orchestration: completed tasks are not re-run", () => {
  test("task processed once is not re-claimed when queue drains", async () => {
    readyQueue = [makeIssue("once-1")]
    readyOneShot = true // After first poll, queue is empty
    claimResults.set("once-1", true)

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-rerun",
    })

    // Wait for processing
    await waitFor(() =>
      calls.some((c) => c.op === "processClaimedTask" && c.id === "once-1"),
    )

    // Let it poll a few more times with empty queue
    await waitFor(
      () => calls.filter((c) => c.op === "queryQueued").length >= 3,
    )
    await worker.interrupt()

    // Task claimed exactly once
    const claimCalls = calls.filter(
      (c) => c.op === "claimTask" && c.id === "once-1",
    )
    expect(claimCalls.length).toBe(1)
  })

  test("ready queue returning same task ID is claimed again (Beads controls re-run)", async () => {
    readyQueue = [makeIssue("resurface-1")]
    readyOneShot = false // Keeps returning the same task
    claimResults.set("resurface-1", true)

    const collectors = makeCollectors()

    // Stop the queue after 2 completions
    let closeCount = 0
    const callbacks: TuiWorkerCallbacks = {
      ...collectors.callbacks,
      onTaskComplete: () => {
        closeCount++
        if (closeCount >= 2) {
          readyQueue = [] // Stop after 2 runs
        }
      },
    }

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-resurface",
    })

    await waitFor(() => closeCount >= 2)
    await worker.interrupt()

    // Should have claimed the task at least twice
    const claimCalls = calls.filter(
      (c) => c.op === "claimTask" && c.id === "resurface-1",
    )
    expect(claimCalls.length).toBeGreaterThanOrEqual(2)
  })
})

describe("worker orchestration: poll-loop correctness", () => {
  test("stale task recovery runs before polling starts", async () => {
    readyQueue = []

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery-order",
    })

    // Wait for at least one poll
    await waitFor(
      () => calls.filter((c) => c.op === "queryQueued").length >= 1,
    )
    await worker.interrupt()

    // recoverStaleTasks should come before any queryQueued
    const recoveryIdx = calls.findIndex((c) => c.op === "recoverStaleTasks")
    const firstPollIdx = calls.findIndex((c) => c.op === "queryQueued")

    expect(recoveryIdx).toBeGreaterThanOrEqual(0)
    expect(firstPollIdx).toBeGreaterThan(recoveryIdx)
  })

  test("empty ready queue means no claims are made", async () => {
    readyQueue = [] // queryQueued returns nothing

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-empty-queue",
    })

    // Let it poll a few times
    await waitFor(
      () => calls.filter((c) => c.op === "queryQueued").length >= 2,
    )
    await worker.interrupt()

    // No claims should have been made
    expect(calls.some((c) => c.op === "claimTask")).toBe(false)
    expect(calls.some((c) => c.op === "processClaimedTask")).toBe(false)
  })

  test("executor does not independently query for non-queued work", async () => {
    readyQueue = []

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-no-fallback",
    })

    await waitFor(
      () => calls.filter((c) => c.op === "queryQueued").length >= 3,
    )
    await worker.interrupt()

    // Only queryQueued and recoverStaleTasks should appear — no other query ops
    const queryOps = calls.filter(
      (c) => c.op !== "queryQueued" && c.op !== "recoverStaleTasks",
    )
    expect(queryOps).toHaveLength(0)
  })
})

describe("worker orchestration: failure then recovery", () => {
  test("system processes a successful task after a prior failure", async () => {
    // First task fails
    readyQueue = [makeIssue("recover-fail")]
    readyOneShot = true
    claimResults.set("recover-fail", true)
    claimResults.set("recover-ok", true)
    processResult = {
      success: false,
      taskId: "recover-fail",
      engine: "claude",
      error: "type error",
    }

    const { callbacks } = makeCollectors()
    const worker = await runWorker(callbacks, {
      pollIntervalMs: 30,
      workerId: "test-recovery",
    })

    // Wait for the failure to be processed
    await waitFor(() =>
      calls.some(
        (c) => c.op === "processClaimedTask" && c.id === "recover-fail",
      ),
    )

    // Now enqueue a successful task
    readyQueue = [makeIssue("recover-ok")]
    processResult = {
      success: true,
      taskId: "recover-ok",
      engine: "claude",
    }

    await waitFor(() =>
      calls.some(
        (c) => c.op === "processClaimedTask" && c.id === "recover-ok",
      ),
    )
    await worker.interrupt()

    // Both tasks were processed
    expect(
      calls.some(
        (c) => c.op === "processClaimedTask" && c.id === "recover-fail",
      ),
    ).toBe(true)
    expect(
      calls.some(
        (c) => c.op === "processClaimedTask" && c.id === "recover-ok",
      ),
    ).toBe(true)

    // Failure must come before the second claim
    const failIdx = calls.findIndex(
      (c) => c.op === "processClaimedTask" && c.id === "recover-fail",
    )
    const secondClaimIdx = calls.findIndex(
      (c) => c.op === "claimTask" && c.id === "recover-ok",
    )
    expect(failIdx).toBeLessThan(secondClaimIdx)
  })
})
