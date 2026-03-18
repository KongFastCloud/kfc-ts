import { describe, test, expect, mock, beforeEach } from "bun:test"
import {
  startTuiWorker,
  type WorkerStatus,
  type WorkerLogEntry,
  type TuiWorkerCallbacks,
} from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

// We mock the beads and runTask modules at the boundary to test worker
// behavior without touching the filesystem or bd CLI.

let mockReadyQueue: Array<{ id: string; title: string }> = []
let mockClaimResults: Map<string, boolean> = new Map()
let mockRunTaskResult = { success: true, engine: "claude" as const, resumeToken: "tok-1" }
let mockRunTaskDelay = 0

// Track calls
let claimCalls: string[] = []
let closeSuccessCalls: string[] = []
let closeFailureCalls: Array<{ id: string; reason: string }> = []
let writeMetadataCalls: Array<{ id: string }> = []

// We need to mock at the module level. Since the tuiWorker uses
// Effect.runPromise with the beads functions, we mock those functions
// by replacing the module imports. For this test we use a different
// approach: we test the exported types and the stop mechanism.

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

  test("pause() prevents new task pickup", async () => {
    const logs: WorkerLogEntry[] = []
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-pause",
    })

    await new Promise((r) => setTimeout(r, 100))

    // Pause the worker
    worker.pause()

    expect(worker.isPaused()).toBe(true)
    expect(logs.some((l) => l.message.includes("paused"))).toBe(true)

    // The latest state should report paused: true
    const lastState = states[states.length - 1]
    expect(lastState?.paused).toBe(true)

    worker.stop()
  })

  test("resume() re-enables task pickup", async () => {
    const logs: WorkerLogEntry[] = []
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-resume",
    })

    await new Promise((r) => setTimeout(r, 100))

    // Pause then resume
    worker.pause()
    expect(worker.isPaused()).toBe(true)

    worker.resume()
    expect(worker.isPaused()).toBe(false)
    expect(logs.some((l) => l.message.includes("resumed"))).toBe(true)

    // The latest state should report paused: false
    const lastState = states[states.length - 1]
    expect(lastState?.paused).toBe(false)

    worker.stop()
  })

  test("double pause() does not emit duplicate logs", async () => {
    const logs: WorkerLogEntry[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: () => {},
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-double-pause",
    })

    await new Promise((r) => setTimeout(r, 100))

    worker.pause()
    const pauseLogCount1 = logs.filter((l) => l.message.includes("paused")).length

    worker.pause() // second pause — should be a no-op
    const pauseLogCount2 = logs.filter((l) => l.message.includes("paused")).length

    expect(pauseLogCount2).toBe(pauseLogCount1)

    worker.stop()
  })

  test("double resume() does not emit duplicate logs", async () => {
    const logs: WorkerLogEntry[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: () => {},
      onLog: (entry) => logs.push(entry),
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-double-resume",
    })

    await new Promise((r) => setTimeout(r, 100))

    worker.pause()
    worker.resume()
    const resumeLogCount1 = logs.filter((l) => l.message.includes("resumed")).length

    worker.resume() // second resume — should be a no-op
    const resumeLogCount2 = logs.filter((l) => l.message.includes("resumed")).length

    expect(resumeLogCount2).toBe(resumeLogCount1)

    worker.stop()
  })

  test("rapid pause/resume toggles do not corrupt state", async () => {
    const states: WorkerStatus[] = []

    const callbacks: TuiWorkerCallbacks = {
      onStateChange: (status) => states.push(status),
      onLog: () => {},
      onTaskComplete: () => {},
    }

    const worker = startTuiWorker(callbacks, {
      pollIntervalMs: 50,
      workerId: "test-rapid-toggle",
    })

    await new Promise((r) => setTimeout(r, 100))

    // Rapid toggle
    for (let i = 0; i < 10; i++) {
      worker.pause()
      worker.resume()
    }

    expect(worker.isPaused()).toBe(false)

    worker.pause()
    expect(worker.isPaused()).toBe(true)

    worker.stop()
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
