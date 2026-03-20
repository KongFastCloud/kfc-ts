import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test"
import { Effect } from "effect"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
} from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Module setup — mock git to avoid dirty-worktree pause in tests
// ---------------------------------------------------------------------------

let startTuiWorker: typeof import("../src/tuiWorker.js").startTuiWorker

beforeAll(async () => {
  // Only mock isWorktreeDirty so the dirty-worktree guard doesn't block tests.
  // Preserve real git exports to avoid leaking stubs into git.test.ts.
  const realGit = await import("../src/git.js")
  mock.module("../src/git.js", () => ({
    ...realGit,
    isWorktreeDirty: () => Effect.succeed(false),
  }))

  mock.module("../src/beads.js", () => ({
    recoverStaleTasks: () => Effect.succeed(0),
    claimTask: () => Effect.succeed(false),
    closeTaskSuccess: () => Effect.succeed(undefined),
    closeTaskFailure: () => Effect.succeed(undefined),
    markTaskExhaustedFailure: () => Effect.succeed(undefined),
    writeMetadata: () => Effect.succeed(undefined),
    readMetadata: () => Effect.succeed(undefined),
    buildPromptFromIssue: (issue: { title: string }) => issue.title,
  }))

  // @ts-expect-error Bun test isolation import suffix is runtime-only.
  ;({ startTuiWorker } = await import("../src/tuiWorker.js?tuiWorker") as typeof import("../src/tuiWorker.js"))
})

afterAll(() => {
  mock.restore()
})

// ---------------------------------------------------------------------------
// Unit tests for worker types and stop behavior
// ---------------------------------------------------------------------------

describe("tuiWorker", () => {
  test("stop() prevents further polling", async () => {
    const logs: WorkerLogEntry[] = []
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    // Start with a very fast poll interval. The worker will fail on
    // queryReady (no bd CLI available in test) but should not crash.
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-worker",
    })

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 100))

    // Stop the worker
    worker.stop()

    // Worker should have logged at least the starting message
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0]!.message).toContain("Worker starting")

    // The stop function should be callable multiple times without error
    worker.stop()
  })

  test("worker logs include timestamps", async () => {
    const logs: WorkerLogEntry[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: () => {},
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-timestamps",
    })

    await new Promise((r) => setTimeout(r, 100))
    worker.stop()

    for (const log of logs) {
      expect(log.timestamp).toBeInstanceOf(Date)
      expect(log.message).toBeTruthy()
    }
  })

  test("worker state starts as idle after initialization", async () => {
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: () => {},
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-idle",
    })

    await new Promise((r) => setTimeout(r, 500))
    worker.stop()

    // Should have an idle state set (either from init or after error recovery)
    expect(states.some((s) => s.state === "idle")).toBe(true)
  })

  test("worker uses custom workerId", async () => {
    const logs: WorkerLogEntry[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: () => {},
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "custom-worker-42",
    })

    await new Promise((r) => setTimeout(r, 100))
    worker.stop()

    const startLog = logs.find((l) => l.message.includes("custom-worker-42"))
    expect(startLog).toBeTruthy()
  })

  test("worker survives adapter errors without crashing", async () => {
    const logs: WorkerLogEntry[] = []
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    // Worker will encounter errors (no bd CLI) but should stay alive
    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-resilient",
    })

    // Let it poll a few times
    await new Promise((r) => setTimeout(r, 300))
    worker.stop()

    // Worker should still be logging (didn't crash)
    expect(logs.length).toBeGreaterThanOrEqual(1)

    // Should have returned to idle after errors
    const lastState = states[states.length - 1]
    expect(lastState?.state).toBe("idle")
  })
})
