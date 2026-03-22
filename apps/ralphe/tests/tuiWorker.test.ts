import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test"
import { Effect, Fiber, ManagedRuntime, Logger } from "effect"
import type {
  WorkerStatus,
  WorkerLogEntry,
  TuiWorkerCallbacks,
  TuiWorkerOptions,
} from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Module setup — mock git, beads, and beadsAdapter for deterministic tests
// ---------------------------------------------------------------------------

let tuiWorkerEffect: typeof import("../src/tuiWorker.js").tuiWorkerEffect

beforeAll(async () => {
  // Only mock isWorktreeDirty so the dirty-worktree guard doesn't block tests.
  // Preserve real git exports to avoid leaking stubs into git.test.ts.
  const realGit = await import("../src/git.js")
  mock.module("../src/git.js", () => ({
    ...realGit,
    isWorktreeDirty: () => Effect.succeed(false),
  }))

  mock.module("../src/beads.js", () => ({
    markTaskReady: () => Effect.succeed(undefined),
    recoverStaleTasks: () => Effect.succeed(0),
    claimTask: () => Effect.succeed(false),
    closeTaskSuccess: () => Effect.succeed(undefined),
    closeTaskFailure: () => Effect.succeed(undefined),
    markTaskExhaustedFailure: () => Effect.succeed(undefined),
    writeMetadata: () => Effect.succeed(undefined),
    readMetadata: () => Effect.succeed(undefined),
    buildPromptFromIssue: (issue: { title: string }) => issue.title,
    addComment: () => Effect.succeed(undefined),
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

/** Minimal layer for testing — file-only logger replaced with a no-op. */
const TestLayer = Logger.replace(Logger.defaultLogger, Logger.make(() => {}))

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

// ---------------------------------------------------------------------------
// Unit tests for worker types and fiber-based lifecycle
// ---------------------------------------------------------------------------

describe("tuiWorker", () => {
  test("interrupt stops the worker cleanly", async () => {
    const logs: WorkerLogEntry[] = []
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-worker",
    })

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 100))

    // Interrupt the worker fiber
    await worker.interrupt()

    // Worker should have logged at least the starting message
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0]!.message).toContain("Worker starting")

    // Worker should have logged the stopped message via Effect.ensuring
    expect(logs.some((l) => l.message === "Worker stopped")).toBe(true)
  })

  test("worker logs include timestamps", async () => {
    const logs: WorkerLogEntry[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: () => {},
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-timestamps",
    })

    await new Promise((r) => setTimeout(r, 100))
    await worker.interrupt()

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

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-idle",
    })

    await new Promise((r) => setTimeout(r, 500))
    await worker.interrupt()

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

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "custom-worker-42",
    })

    await new Promise((r) => setTimeout(r, 100))
    await worker.interrupt()

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

    const worker = await runWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-resilient",
    })

    // Let it poll a few times
    await new Promise((r) => setTimeout(r, 300))
    await worker.interrupt()

    // Worker should still be logging (didn't crash)
    expect(logs.length).toBeGreaterThanOrEqual(1)

    // Should have returned to idle after errors
    const lastState = states[states.length - 1]
    expect(lastState?.state).toBe("idle")
  })
})
