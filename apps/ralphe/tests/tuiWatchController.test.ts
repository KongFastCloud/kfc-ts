/**
 * ABOUTME: Tests for the TUI watch controller orchestration layer.
 * Owns the contract that createTuiWatchController correctly wires worker
 * start/stop, task refresh, and mark-ready lifecycle through the controller
 * interface. Exercises the controller's coordination of subsystems without
 * re-proving worker internals (owned by tuiWorker.test.ts) or task processing
 * (owned by watchWorkflow.test.ts).
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import type { RalpheConfig } from "../src/config.js"
import {
  createTuiWatchController,
  type TuiWatchController,
  type TuiWatchControllerDeps,
  type TuiWatchControllerOptions,
} from "../src/tuiWatchController.js"
import {
  tuiWorkerEffect,
  type TuiWorkerDeps,
} from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Local test harness state
// ---------------------------------------------------------------------------

const mockTasks = [
  { id: "T-1", title: "Task One", status: "queued" as const },
  { id: "T-2", title: "Task Two", status: "done" as const },
]

let markReadyCalls: Array<{ id: string; labels: string[] }> = []
const baseConfig: RalpheConfig = {
  engine: "claude",
  checks: [],
  report: "none",
  maxAttempts: 1,
  git: { mode: "none" },
}

beforeEach(() => {
  markReadyCalls = []
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal layer for testing — file-only logger replaced with a no-op. */
const TestLayer: Layer.Layer<never> = Logger.replace(
  Logger.defaultLogger,
  Logger.make(() => {}),
)

function makeWorkerDeps(): TuiWorkerDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () => Effect.succeed([]),
    claimTask: () => Effect.succeed(false),
    recoverStaleTasks: () => Effect.succeed(0),
    isWorktreeDirty: () => Effect.succeed(false),
    processClaimedTask: () =>
      Effect.succeed({
        success: true,
        taskId: "noop",
        engine: "claude" as const,
      }),
  }
}

function makeControllerDeps(
  overrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchControllerDeps {
  return {
    queryAllTasks: () => Effect.succeed(mockTasks),
    markTaskReady: (id: string, labels: string[]) => {
      markReadyCalls.push({ id, labels })
      return Effect.succeed(undefined)
    },
    tuiWorkerEffect,
    workerDeps: makeWorkerDeps(),
    loadConfig: () => baseConfig,
    ...overrides,
  }
}

function makeController(overrides?: Partial<TuiWatchControllerOptions>): TuiWatchController {
  return createTuiWatchController(TestLayer, {
    refreshIntervalMs: 50,
    workDir: process.cwd(),
    workerId: "test-controller",
    deps: makeControllerDeps(overrides?.deps as Partial<TuiWatchControllerDeps> | undefined),
    ...overrides,
  })
}

/** Flush pending microtasks so the consumer fiber can advance. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** Wait for a condition with a timeout. Default 5s for CI reliability. */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}

// ---------------------------------------------------------------------------
// State ownership
// ---------------------------------------------------------------------------

describe("TuiWatchController — state ownership", () => {
  test("initial state has idle worker, empty tasks, no error, no pending IDs", () => {
    const ctrl = makeController()
    const state = ctrl.getState()

    expect(state.workerStatus).toEqual({ state: "idle" })
    expect(state.latestTasks).toEqual([])
    expect(state.refreshError).toBeUndefined()
    expect(state.lastRefreshed).toBeNull()
    expect(state.markReadyPendingIds.size).toBe(0)

    void ctrl.stop()
  })

  test("refresh updates latestTasks, lastRefreshed, and clears refreshError", async () => {
    const ctrl = makeController()

    await ctrl.refresh()

    const state = ctrl.getState()
    expect(state.latestTasks).toEqual(mockTasks)
    expect(state.refreshError).toBeUndefined()
    expect(state.lastRefreshed).toBeInstanceOf(Date)

    await ctrl.stop()
  })

  test("refresh failure captures refreshError without losing previous tasks", async () => {
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.fail(new Error("network error")) as Effect.Effect<never, unknown>,
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    // refresh() should throw, but the controller captures the error in state
    await expect(ctrl.refresh()).rejects.toThrow()

    const state = ctrl.getState()
    expect(state.refreshError).toContain("Refresh failed")
    expect(state.refreshError).toContain("network error")
    // latestTasks stays at default (no previous data to lose)
    expect(state.latestTasks).toEqual([])

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Runtime ownership — single scoped runtime for all commands
// ---------------------------------------------------------------------------

describe("TuiWatchController — runtime ownership", () => {
  test("concurrent commands share the same scoped runtime", async () => {
    const ctrl = makeController()

    // Multiple operations through the same runtime should all succeed
    const [tasks, result] = await Promise.all([
      ctrl.refresh(),
      ctrl.runEffect(Effect.succeed("hello")),
    ])

    expect(tasks).toEqual(mockTasks)
    expect(result).toBe("hello")

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Refresh coalescing
// ---------------------------------------------------------------------------

describe("TuiWatchController — refresh coalescing", () => {
  test("second concurrent refresh is a no-op returning stale state", async () => {
    const ctrl = makeController()

    // Fire two concurrent refreshes — the second should be a no-op
    const [tasks1, tasks2] = await Promise.all([
      ctrl.refresh(),
      ctrl.refresh(),
    ])

    expect(tasks1).toEqual(mockTasks)
    // Second call returns the stale latestTasks (no-op path).
    // Before first refresh completes, latestTasks is still [].
    expect(tasks2).toEqual([])

    // After both settle, state reflects the first refresh's result.
    expect(ctrl.getState().latestTasks).toEqual(mockTasks)

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Periodic refresh
// ---------------------------------------------------------------------------

describe("TuiWatchController — periodic refresh", () => {
  test("fires refresh on the configured interval (idempotent start)", async () => {
    const ctrl = makeController({ refreshIntervalMs: 50 })
    let refreshCount = 0
    ctrl.onStateChange(() => {
      if (ctrl.getState().latestTasks.length > 0) refreshCount++
    })

    // Double-call verifies idempotency — no second daemon is created.
    ctrl.startPeriodicRefresh()
    ctrl.startPeriodicRefresh()

    // Wait for at least 2 periodic refreshes
    await new Promise((r) => setTimeout(r, 150))

    expect(refreshCount).toBeGreaterThanOrEqual(2)

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Worker wiring
// ---------------------------------------------------------------------------

describe("TuiWatchController — worker wiring", () => {
  test("startWorker() transitions workerStatus through state change callbacks (idempotent start)", async () => {
    const ctrl = makeController()
    const states: Array<{ state: string }> = []

    ctrl.onStateChange(() => {
      states.push({ ...ctrl.getState().workerStatus })
    })

    // Double-call verifies idempotency — no duplicate worker is created.
    ctrl.startWorker()
    ctrl.startWorker()

    // Give the worker a tick to start and poll
    await new Promise((r) => setTimeout(r, 200))

    // Worker should have transitioned to idle after initialization
    expect(states.some((s) => s.state === "idle")).toBe(true)

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Mark-ready queue wiring
// ---------------------------------------------------------------------------

describe("TuiWatchController — mark-ready queue wiring", () => {
  test("enqueueMarkReady() processes items through the queue consumer", async () => {
    markReadyCalls = []
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("T-1", ["bug"])
    await waitFor(() => markReadyCalls.length >= 1)

    expect(markReadyCalls).toEqual([{ id: "T-1", labels: ["bug"] }])

    await ctrl.stop()
  })

  test("queue preserves FIFO ordering", async () => {
    markReadyCalls = []
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("A", ["x"])
    ctrl.enqueueMarkReady("B", ["y"])
    ctrl.enqueueMarkReady("C", ["z"])

    await waitFor(() => markReadyCalls.length >= 3)

    expect(markReadyCalls.map((c) => c.id)).toEqual(["A", "B", "C"])

    await ctrl.stop()
  })

  test("duplicate task IDs are rejected", async () => {
    markReadyCalls = []
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("A", ["x"])
    ctrl.enqueueMarkReady("B", ["y"])
    ctrl.enqueueMarkReady("B", ["y2"]) // duplicate — should be rejected

    await waitFor(() => markReadyCalls.length >= 2)
    // Give a bit more time to ensure no extra call comes
    await flush()

    expect(markReadyCalls.map((c) => c.id)).toEqual(["A", "B"])

    await ctrl.stop()
  })

  test("pendingIds tracks queued items and clears after completion", async () => {
    markReadyCalls = []
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("A", [])
    ctrl.enqueueMarkReady("B", [])
    ctrl.enqueueMarkReady("C", [])

    // Immediately after enqueue, all IDs should be pending
    const pending = ctrl.getState().markReadyPendingIds
    expect(pending.has("A")).toBe(true)
    expect(pending.has("B")).toBe(true)
    expect(pending.has("C")).toBe(true)

    // Wait for all to complete
    await waitFor(() => markReadyCalls.length >= 3)
    // Give state a moment to update
    await flush()
    await new Promise((r) => setTimeout(r, 50))

    const pendingAfter = ctrl.getState().markReadyPendingIds
    expect(pendingAfter.size).toBe(0)

    await ctrl.stop()
  })

  test("enqueueMarkReady is a no-op before startMarkReadyConsumer", async () => {
    markReadyCalls = []
    const ctrl = makeController()

    // Enqueue before consumer is started — should be silently dropped
    ctrl.enqueueMarkReady("X", [])
    expect(ctrl.getState().markReadyPendingIds.size).toBe(0)

    await ctrl.stop()
  })

  test("startMarkReadyConsumer() is idempotent — no duplicate consumer", async () => {
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()
    await ctrl.startMarkReadyConsumer() // Should not create a second consumer

    markReadyCalls = []
    ctrl.enqueueMarkReady("A", [])
    await waitFor(() => markReadyCalls.length >= 1)

    // Only one call — not duplicated by a second consumer
    expect(markReadyCalls).toHaveLength(1)

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Cleanup / disposal
// ---------------------------------------------------------------------------

describe("TuiWatchController — cleanup", () => {
  test("stop() shuts down queue — enqueue after stop is a no-op", async () => {
    markReadyCalls = []
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("A", [])
    await waitFor(() => markReadyCalls.length >= 1)

    await ctrl.stop()

    // After stop, enqueue should be silently dropped
    ctrl.enqueueMarkReady("POST", ["y"])
    await flush()
    await new Promise((r) => setTimeout(r, 50))

    expect(markReadyCalls.map((c) => c.id)).not.toContain("POST")
  })
})
