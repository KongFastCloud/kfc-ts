/**
 * ABOUTME: Deterministic unit tests for tuiWorker fiber-based lifecycle.
 * Covers only worker-specific unit behavior: interrupt/stop, log entry shape,
 * idle/running state transitions, custom worker ID propagation, and resilience
 * when adapter calls fail.
 *
 * All adapter and workflow boundaries are explicitly mocked — no test relies
 * on ambient environment state (missing .beads DB, unavailable bd CLI, etc.).
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

// ---------------------------------------------------------------------------
// Module setup — explicit mocks for every external boundary
// ---------------------------------------------------------------------------

let tuiWorkerEffect: typeof import("../src/tuiWorker.js").tuiWorkerEffect

beforeAll(async () => {
  // Mock git — only isWorktreeDirty matters; keep worktree clean.
  const realGit = await import("../src/git.js")
  mock.module("../src/git.js", () => ({
    ...realGit,
    isWorktreeDirty: () => Effect.succeed(false),
  }))

  // Mock beadsAdapter — explicit control over queryQueued
  mock.module("../src/beadsAdapter.js", () => ({
    queryQueued: () => {
      if (queryQueuedError) return Effect.fail(queryQueuedError)
      const result = [...readyQueue]
      readyQueue = [] // one-shot: return queue then empty
      return Effect.succeed(result)
    },
  }))

  // Mock beads — deterministic, no-op implementations
  mock.module("../src/beads.js", () => ({
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

  // Mock watchWorkflow — processClaimedTask returns success by default
  mock.module("../src/watchWorkflow.js", () => ({
    processClaimedTask: () =>
      Effect.succeed({ success: true, engine: "claude", resumeToken: "tok" }),
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

    // Let the worker start and enter polling
    await new Promise((r) => setTimeout(r, 100))
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

    await new Promise((r) => setTimeout(r, 100))
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

    await new Promise((r) => setTimeout(r, 150))
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

    const { states, logs, callbacks } = makeCollectors()

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-running",
    })

    // Allow time for poll → claim → execute → complete
    await new Promise((r) => setTimeout(r, 300))
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

    await new Promise((r) => setTimeout(r, 100))
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

    // Let it poll and hit the error several times
    await new Promise((r) => setTimeout(r, 250))
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

    await new Promise((r) => setTimeout(r, 250))
    await worker.interrupt()

    // Worker logged the claim failure
    expect(logs.some((l) => l.message.includes("claim lock timeout"))).toBe(true)

    // Worker did not transition to running (claim failed before that)
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

    await new Promise((r) => setTimeout(r, 300))
    await worker.interrupt()

    expect(taskCompletions.length).toBeGreaterThanOrEqual(1)
  })
})
