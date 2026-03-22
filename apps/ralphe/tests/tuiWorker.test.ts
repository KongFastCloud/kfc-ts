/**
 * ABOUTME: Deterministic unit tests for tuiWorker fiber-based lifecycle.
 * Covers only worker-specific unit behavior: interrupt/stop, log entry shape,
 * idle/running state transitions, custom worker ID propagation, and resilience
 * when adapter calls fail.
 *
 * All adapter and workflow boundaries are explicitly mocked — no test relies
 * on ambient environment state (missing .beads DB, unavailable bd CLI,
 * filesystem config, etc.).
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test"
import { Effect, Fiber, ManagedRuntime, Logger } from "effect"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
  TuiWorkerOptions,
} from "../src/tuiWorker.js"
import type { BeadsIssue } from "../src/beads.js"

// ---------------------------------------------------------------------------
// Configurable stubs — tests set these before starting the worker
// ---------------------------------------------------------------------------

/** Tasks returned by the adapter's queryQueued. Empty by default. */
let readyQueue: BeadsIssue[] = []

/** Controls whether claimTask succeeds. */
let claimResult = true

/** Error to inject into queryQueued. When set, queryQueued will fail. */
let queryQueuedError: Error | null = null

/** Error to inject into claimTask. When set, claimTask will fail. */
let claimTaskError: Error | null = null

/** Controls the result of processClaimedTask. */
let processResult: { success: boolean; engine: "claude" | "codex"; resumeToken?: string; error?: string } = {
  success: true,
  engine: "claude",
  resumeToken: "tok",
}

/** Error to inject into processClaimedTask. When set, processClaimedTask will fail. */
let processError: Error | null = null

// ---------------------------------------------------------------------------
// Module setup — explicit mocks for every external boundary
// ---------------------------------------------------------------------------

let tuiWorkerEffect: typeof import("../src/tuiWorker.js").tuiWorkerEffect

beforeAll(async () => {
  // Import real modules first so the spread preserves all exports.
  // This prevents SyntaxError ("Export named … not found") when Bun's
  // module mock leaks into other test files sharing the same CI process.
  const realGit = await import("../src/git.js?real-tuiWorker-git")
  const realAdapter = await import("../src/beadsAdapter.js?real-tuiWorker-adapter")
  const realBeads = await import("../src/beads.js?real-tuiWorker-beads")
  const realWorkflow = await import("../src/watchWorkflow.js?real-tuiWorker-workflow")
  const realConfig = await import("../src/config.js?real-tuiWorker-config")

  // Mock git — only isWorktreeDirty matters; keep worktree clean.
  mock.module("../src/git.js", () => ({
    ...realGit,
    isWorktreeDirty: () => Effect.succeed(false),
  }))

  // Mock beadsAdapter — explicit control over queryQueued, preserve other exports.
  mock.module("../src/beadsAdapter.js", () => ({
    ...realAdapter,
    queryQueued: () => {
      if (queryQueuedError) return Effect.fail(queryQueuedError)
      const result = [...readyQueue]
      readyQueue = [] // one-shot: return queue then empty
      return Effect.succeed(result)
    },
  }))

  // Mock beads — deterministic, no-op implementations; preserve other exports.
  mock.module("../src/beads.js", () => ({
    ...realBeads,
    markTaskReady: () => Effect.succeed(undefined),
    recoverStaleTasks: () => Effect.succeed(0),
    claimTask: () => {
      if (claimTaskError) return Effect.fail(claimTaskError)
      return Effect.succeed(claimResult)
    },
    closeTaskSuccess: () => Effect.succeed(undefined),
    closeTaskFailure: () => Effect.succeed(undefined),
    markTaskExhaustedFailure: () => Effect.succeed(undefined),
    writeMetadata: () => Effect.succeed(undefined),
    readMetadata: () => Effect.succeed(undefined),
    buildPromptFromIssue: (issue: { title: string }) => issue.title,
    addComment: () => Effect.succeed(undefined),
  }))

  // Mock watchWorkflow — configurable processClaimedTask result; preserve other exports.
  mock.module("../src/watchWorkflow.js", () => ({
    ...realWorkflow,
    processClaimedTask: () => {
      if (processError) return Effect.fail(processError)
      return Effect.succeed(processResult)
    },
  }))

  // Mock config — no filesystem access; return deterministic defaults; preserve other exports.
  mock.module("../src/config.js", () => ({
    ...realConfig,
    loadConfig: () => ({
      engine: "claude" as const,
      checks: [],
      report: "none",
      maxAttempts: 1,
      git: { mode: "none" as const },
    }),
  }))

  // @ts-expect-error Bun test isolation import suffix is runtime-only.
  ;({ tuiWorkerEffect } = await import("../src/tuiWorker.js?tuiWorker") as typeof import("../src/tuiWorker.js"))
})

afterAll(() => {
  mock.restore()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal layer for testing — replace default logger with no-op. */
const TestLayer = Logger.replace(Logger.defaultLogger, Logger.make(() => {}))

/** Reset all configurable stubs to defaults. */
function resetStubs() {
  readyQueue = []
  claimResult = true
  queryQueuedError = null
  claimTaskError = null
  processResult = { success: true, engine: "claude", resumeToken: "tok" }
  processError = null
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
    Effect.forkDaemon(tuiWorkerEffect(callbacks, opts)),
  )
  return {
    interrupt: async () => {
      await runtime.runPromise(Fiber.interrupt(fiber))
      await runtime.dispose()
    },
  }
}

/** Build a minimal TuiWorkerCallbacks that collects logs and state changes. */
function makeCollectors() {
  const logs: WorkerLogEntry[] = []
  const states: WorkerStatus[] = []
  const taskCompletions: number[] = []
  const callbacks: TuiWorkerCallbacks = {
    onStateChange: (status) => states.push(status),
    onLog: (entry) => logs.push(entry),
    onTaskComplete: () => taskCompletions.push(Date.now()),
  }
  return { logs, states, taskCompletions, callbacks }
}

/** Wait until a predicate becomes true or timeout. More reliable than fixed delays in CI. */
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
// Tests
// ---------------------------------------------------------------------------

describe("tuiWorker", () => {
  test("interrupt stops the worker and emits 'Worker stopped' log", async () => {
    resetStubs()
    const { logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-interrupt",
    })

    // Wait until the worker has started and entered polling
    await waitFor(() => logs.some((l) => l.message.includes("polling for tasks")))
    await worker.interrupt()

    // Must have the starting and stopped bookend messages
    expect(logs[0]!.message).toContain("Worker starting")
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("every log entry has a Date timestamp and non-empty message", async () => {
    resetStubs()
    const { logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-log-shape",
    })

    await waitFor(() => logs.some((l) => l.message.includes("polling for tasks")))
    await worker.interrupt()

    expect(logs.length).toBeGreaterThanOrEqual(1)
    for (const log of logs) {
      expect(log.timestamp).toBeInstanceOf(Date)
      expect(typeof log.message).toBe("string")
      expect(log.message.length).toBeGreaterThan(0)
    }
  })

  test("worker transitions to idle when no tasks are queued", async () => {
    resetStubs()
    // readyQueue is empty by default — queryQueued returns []
    const { states, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-idle",
    })

    // Wait until the worker has set state at least once
    await waitFor(() => states.some((s) => s.state === "idle"))
    await worker.interrupt()

    // The worker should explicitly set state to idle after initialization
    expect(states.some((s) => s.state === "idle")).toBe(true)
    // Should never have entered running since no task was queued
    expect(states.some((s) => s.state === "running")).toBe(false)
  })

  test("worker transitions idle → running → idle when a task is claimed", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-1", title: "Do something" }]
    claimResult = true

    const { states, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-running",
    })

    // Wait for the full cycle: idle → running → idle (after task completes)
    await waitFor(() => {
      const stateNames = states.map((s) => s.state)
      const runningIdx = stateNames.indexOf("running")
      return runningIdx >= 0 && stateNames.indexOf("idle", runningIdx + 1) > runningIdx
    })
    await worker.interrupt()

    // Must see idle → running → idle
    const stateNames = states.map((s) => s.state)
    const runningIdx = stateNames.indexOf("running")
    expect(runningIdx).toBeGreaterThanOrEqual(0)

    // The running state should carry the task ID
    expect(states[runningIdx]!.currentTaskId).toBe("TASK-1")

    // After the task completes, should return to idle
    const idleAfterRunning = stateNames.indexOf("idle", runningIdx + 1)
    expect(idleAfterRunning).toBeGreaterThan(runningIdx)
  })

  test("custom workerId appears in the starting log message", async () => {
    resetStubs()
    const { logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "custom-worker-42",
    })

    await waitFor(() => logs.some((l) => l.message.includes("custom-worker-42")))
    await worker.interrupt()

    const startLog = logs.find((l) => l.message.includes("custom-worker-42"))
    expect(startLog).toBeTruthy()
  })

  test("worker survives queryQueued adapter error and returns to idle", async () => {
    resetStubs()
    queryQueuedError = new Error("adapter connection refused")

    const { states, logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-adapter-error",
    })

    // Wait until the worker has logged the error at least once
    await waitFor(() => logs.some((l) => l.message.includes("adapter connection refused")))
    await worker.interrupt()

    // Worker must still be alive — it logged the error and didn't crash
    expect(logs.some((l) => l.message.includes("adapter connection refused"))).toBe(true)

    // Should have returned to idle after the error
    const lastState = states[states.length - 1]
    expect(lastState?.state).toBe("idle")

    // Must emit the stopped message — proving the fiber was still alive to be interrupted
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("worker survives claimTask failure and returns to idle", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-FAIL", title: "Will fail claim" }]
    claimTaskError = new Error("claim lock timeout")

    const { states, logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-claim-error",
    })

    // Wait until the worker has logged the claim failure
    await waitFor(() => logs.some((l) => l.message.includes("claim lock timeout")))
    await worker.interrupt()

    // Worker logged the claim failure
    expect(logs.some((l) => l.message.includes("claim lock timeout"))).toBe(true)

    // Worker did not transition to running (claim failed before that)
    expect(states.some((s) => s.state === "running")).toBe(false)

    // Worker is still alive and stopped cleanly
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("claim contention: worker stays idle when another worker claims first", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-RACE", title: "Already claimed" }]
    claimResult = false // another worker won the race

    const { states, logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-contention",
    })

    // Wait for the "already claimed" log message
    await waitFor(() => logs.some((l) => l.message.includes("already claimed")))
    await worker.interrupt()

    // Worker should log the skip
    expect(logs.some((l) => l.message.includes("already claimed") && l.message.includes("TASK-RACE"))).toBe(true)

    // Worker must not have entered running state — it never owned the task
    expect(states.some((s) => s.state === "running")).toBe(false)

    // Worker is still alive and stopped cleanly
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("onTaskComplete callback fires after a task finishes", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-CB", title: "Callback test" }]
    claimResult = true

    const { taskCompletions, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-callback",
    })

    // Wait for the callback to fire
    await waitFor(() => taskCompletions.length >= 1)
    await worker.interrupt()

    expect(taskCompletions.length).toBeGreaterThanOrEqual(1)
  })

  test("onTaskComplete fires for failed tasks too", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-FAIL-CB", title: "Will fail" }]
    claimResult = true
    processResult = { success: false, engine: "claude", error: "checks failed" }

    const { taskCompletions, logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-fail-callback",
    })

    // Wait for the callback to fire
    await waitFor(() => taskCompletions.length >= 1)
    await worker.interrupt()

    expect(taskCompletions.length).toBeGreaterThanOrEqual(1)
    // Worker should log the exhausted failure
    expect(logs.some((l) => l.message.includes("exhausted"))).toBe(true)
  })

  test("worker survives processClaimedTask defect and fires onTaskComplete", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-DEFECT", title: "Will throw" }]
    claimResult = true
    processError = new Error("unexpected null pointer")

    const { states, logs, taskCompletions, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-defect",
    })

    // Wait for the worker to log the unexpected failure
    await waitFor(() => logs.some((l) => l.message.includes("unexpected null pointer")))
    await worker.interrupt()

    // Worker logged the defect with the original error message
    expect(logs.some((l) => l.message.includes("threw unexpectedly") && l.message.includes("unexpected null pointer"))).toBe(true)

    // Worker returned to idle after the defect
    const lastState = states[states.length - 1]
    expect(lastState?.state).toBe("idle")

    // onTaskComplete still fires — the UI needs to know something happened
    expect(taskCompletions.length).toBeGreaterThanOrEqual(1)

    // Worker is still alive and stopped cleanly
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("log entries during task execution carry the task ID", async () => {
    resetStubs()
    readyQueue = [{ id: "TASK-LOG-ID", title: "Log ID test" }]
    claimResult = true

    const { logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-log-id",
    })

    // Wait for the task to complete
    await waitFor(() => logs.some((l) => l.message.includes("completed successfully")))
    await worker.interrupt()

    // Logs about finding, claiming, and executing the task should carry its ID
    const taskLogs = logs.filter((l) => l.taskId === "TASK-LOG-ID")
    expect(taskLogs.length).toBeGreaterThanOrEqual(3) // found, claimed, executing/completed

    // Startup and stopped logs should NOT carry a taskId
    const startLog = logs.find((l) => l.message.includes("Worker starting"))
    expect(startLog?.taskId).toBeUndefined()

    const stoppedLog = logs.find((l) => l.message === "Worker stopped")
    expect(stoppedLog?.taskId).toBeUndefined()
  })
})
