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

const mockDetailTask = {
  id: "T-1",
  title: "Task One",
  status: "queued" as const,
  comments: [
    { id: "c1", author: "bot", text: "Attempted with claude", createdAt: "2026-01-01T00:00:00Z" },
  ],
}

function makeControllerDeps(
  overrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchControllerDeps {
  return {
    queryAllTasks: () => Effect.succeed(mockTasks),
    queryTaskDetail: (id: string) => Effect.succeed(id === "T-1" ? mockDetailTask : undefined),
    markTaskReady: (id: string, labels: string[]) => {
      markReadyCalls.push({ id, labels })
      return Effect.succeed(undefined)
    },
    tuiWorkerEffect,
    workerDeps: makeWorkerDeps(),
    loadConfig: () => baseConfig,
    closeEpic: () => Effect.succeed({ removed: false, wasDirty: false }),
    getEpicWorktreeState: () => Effect.succeed("not_started" as const),
    getEpicRuntimeStatus: () => Effect.succeed("no_attempt" as const),
    ...overrides,
  }
}

function makeController(overrides?: Partial<TuiWatchControllerOptions>): TuiWatchController {
  // Extract deps separately to avoid the spread overwriting the fully-mocked
  // deps object with a partial override (which would leave un-overridden deps
  // pointing at the real bd CLI — breaks in CI where bd isn't installed).
  const { deps: depsOverrides, ...restOverrides } = overrides ?? {}
  return createTuiWatchController(TestLayer, {
    refreshIntervalMs: 50,
    workDir: process.cwd(),
    workerId: "test-controller",
    deps: makeControllerDeps(depsOverrides as Partial<TuiWatchControllerDeps> | undefined),
    ...restOverrides,
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
// Detail view — full task detail fetch
// ---------------------------------------------------------------------------

describe("TuiWatchController — detail view", () => {
  test("initial detail state is empty", () => {
    const ctrl = makeController()
    const state = ctrl.getState()

    expect(state.detailTask).toBeUndefined()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toBeUndefined()
    expect(state.detailTaskId).toBeUndefined()

    void ctrl.stop()
  })

  test("fetchTaskDetail loads full detail including comments", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")

    const state = ctrl.getState()
    expect(state.detailTaskId).toBe("T-1")
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toBeUndefined()
    expect(state.detailTask).toBeDefined()
    expect(state.detailTask!.id).toBe("T-1")
    expect(state.detailTask!.comments).toHaveLength(1)
    expect(state.detailTask!.comments![0]!.text).toBe("Attempted with claude")

    await ctrl.stop()
  })

  test("fetchTaskDetail sets loading state during fetch", async () => {
    const states: boolean[] = []
    const ctrl = makeController({
      deps: {
        queryTaskDetail: (id: string) => {
          // Capture the loading state during the fetch
          states.push(ctrl.getState().detailLoading)
          return Effect.succeed(mockDetailTask)
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.fetchTaskDetail("T-1")

    // Loading should have been true during the fetch
    expect(states).toContain(true)
    // After fetch completes, loading should be false
    expect(ctrl.getState().detailLoading).toBe(false)

    await ctrl.stop()
  })

  test("fetchTaskDetail sets error for unknown task", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("NONEXISTENT")

    const state = ctrl.getState()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toContain("not found")
    expect(state.detailTask).toBeUndefined()

    await ctrl.stop()
  })

  test("fetchTaskDetail sets error on fetch failure", async () => {
    const ctrl = makeController({
      deps: {
        queryTaskDetail: () => Effect.fail(new Error("network error")) as Effect.Effect<never, unknown>,
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.fetchTaskDetail("T-1")

    const state = ctrl.getState()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toContain("Detail fetch failed")
    expect(state.detailError).toContain("network error")

    await ctrl.stop()
  })

  test("exitDetailView clears all detail state", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailTask).toBeDefined()

    ctrl.exitDetailView()

    const state = ctrl.getState()
    expect(state.detailTask).toBeUndefined()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toBeUndefined()
    expect(state.detailTaskId).toBeUndefined()

    await ctrl.stop()
  })

  test("refresh re-fetches detail when detail view is open", async () => {
    let detailCallCount = 0
    const ctrl = makeController({
      deps: {
        queryTaskDetail: (id: string) => {
          detailCallCount++
          return Effect.succeed(id === "T-1" ? mockDetailTask : undefined)
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    // Enter detail view
    await ctrl.fetchTaskDetail("T-1")
    expect(detailCallCount).toBe(1)

    // Trigger a refresh — should also re-fetch detail
    await ctrl.refresh()
    await waitFor(() => detailCallCount >= 2)

    expect(detailCallCount).toBeGreaterThanOrEqual(2)

    await ctrl.stop()
  })

  test("refresh does not fetch detail when no detail view is open", async () => {
    let detailCallCount = 0
    const ctrl = makeController({
      deps: {
        queryTaskDetail: () => {
          detailCallCount++
          return Effect.succeed(mockDetailTask)
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.refresh()
    await flush()

    expect(detailCallCount).toBe(0)

    await ctrl.stop()
  })

  test("stale detail fetch result is discarded after navigating away", async () => {
    let resolveDetail: ((task: typeof mockDetailTask | undefined) => void) | null = null
    const ctrl = makeController({
      deps: {
        queryTaskDetail: () =>
          Effect.promise(
            () => new Promise<typeof mockDetailTask | undefined>((r) => { resolveDetail = r }),
          ),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    // Start detail fetch (don't await — it's intentionally deferred)
    const fetchPromise = ctrl.fetchTaskDetail("T-1")

    // Wait for the deferred callback to be set
    await waitFor(() => resolveDetail !== null)

    // Exit detail view before fetch completes
    ctrl.exitDetailView()

    // Now resolve the deferred detail fetch
    resolveDetail!(mockDetailTask)
    await fetchPromise

    // The stale result should have been discarded — detailTaskId was cleared
    const state = ctrl.getState()
    expect(state.detailTask).toBeUndefined()
    expect(state.detailTaskId).toBeUndefined()

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Epic pane — split model state and derived statuses
// ---------------------------------------------------------------------------

describe("TuiWatchController — epic pane state", () => {
  test("initial state has empty epics and no epic delete pending IDs", () => {
    const ctrl = makeController()
    const state = ctrl.getState()

    expect(state.epics).toEqual([])
    expect(state.epicDeletePendingIds.size).toBe(0)

    void ctrl.stop()
  })

  test("refresh derives epic display items from task list", async () => {
    const epicTasks = [
      { id: "E-1", title: "Epic One", status: "backlog" as const, labels: ["epic"] },
      { id: "T-1", title: "Task One", status: "queued" as const },
      { id: "E-2", title: "Epic Two", status: "backlog" as const, labels: ["epic"] },
    ]
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed(epicTasks),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.refresh()

    const state = ctrl.getState()
    expect(state.epics).toHaveLength(2)
    expect(state.epics.map((e) => e.id)).toEqual(["E-1", "E-2"])
    // Worktree state defaults to not_started (mock returns not_started)
    expect(state.epics[0]!.status).toBe("not_started")
    expect(state.epics[1]!.status).toBe("not_started")

    await ctrl.stop()
  })

  test("epic display items reflect worktree state from getEpicWorktreeState", async () => {
    const epicTasks = [
      { id: "E-clean", title: "Clean Epic", status: "backlog" as const, labels: ["epic"] },
      { id: "E-dirty", title: "Dirty Epic", status: "backlog" as const, labels: ["epic"] },
    ]
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed(epicTasks),
        getEpicWorktreeState: (id: string) => {
          if (id === "E-clean") return Effect.succeed("clean" as const)
          if (id === "E-dirty") return Effect.succeed("dirty" as const)
          return Effect.succeed("not_started" as const)
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.refresh()

    const state = ctrl.getState()
    const clean = state.epics.find((e) => e.id === "E-clean")
    const dirty = state.epics.find((e) => e.id === "E-dirty")
    expect(clean!.status).toBe("active") // clean worktree → active
    expect(dirty!.status).toBe("dirty")

    await ctrl.stop()
  })

  test("epic display items reflect runtime error state with highest precedence", async () => {
    const epicTasks = [
      { id: "E-error", title: "Errored Epic", status: "backlog" as const, labels: ["epic"] },
    ]
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed(epicTasks),
        getEpicWorktreeState: () => Effect.succeed("dirty" as const),
        getEpicRuntimeStatus: () => Effect.succeed("error" as const),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.refresh()

    const state = ctrl.getState()
    const errored = state.epics.find((e) => e.id === "E-error")
    expect(errored!.status).toBe("error")

    await ctrl.stop()
  })

  test("closed epics without deletion queue are excluded", async () => {
    const epicTasks = [
      { id: "E-open", title: "Open Epic", status: "backlog" as const, labels: ["epic"] },
      { id: "E-closed", title: "Closed Epic", status: "done" as const, labels: ["epic"] },
    ]
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed(epicTasks),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })

    await ctrl.refresh()

    const state = ctrl.getState()
    expect(state.epics).toHaveLength(1)
    expect(state.epics[0]!.id).toBe("E-open")

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Epic delete queue — distinct from mark-ready queue
// ---------------------------------------------------------------------------

describe("TuiWatchController — epic delete queue", () => {
  test("enqueueEpicDelete adds epic to pending set and updates status", async () => {
    const epicTasks = [
      { id: "E-1", title: "Epic One", status: "backlog" as const, labels: ["epic"] },
    ]
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed(epicTasks),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })
    await ctrl.refresh()
    await ctrl.startEpicDeleteConsumer()

    ctrl.enqueueEpicDelete("E-1")

    const state = ctrl.getState()
    expect(state.epicDeletePendingIds.has("E-1")).toBe(true)

    // Epic should now show queued_for_deletion status
    const epic = state.epics.find((e) => e.id === "E-1")
    expect(epic!.status).toBe("queued_for_deletion")

    await ctrl.stop()
  })

  test("duplicate epic delete is silently rejected", async () => {
    let closeCallCount = 0
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed([
          { id: "E-1", title: "Epic One", status: "backlog" as const, labels: ["epic"] },
        ]),
        closeEpic: () => {
          closeCallCount++
          return Effect.succeed({ removed: true, wasDirty: false })
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })
    await ctrl.refresh()
    await ctrl.startEpicDeleteConsumer()

    ctrl.enqueueEpicDelete("E-1")
    ctrl.enqueueEpicDelete("E-1") // duplicate

    await waitFor(() => closeCallCount >= 1)
    await new Promise((r) => setTimeout(r, 50))

    // Only one closeEpic call — duplicate was rejected
    expect(closeCallCount).toBe(1)

    await ctrl.stop()
  })

  test("enqueueEpicDelete is a no-op before startEpicDeleteConsumer", async () => {
    const ctrl = makeController()

    // Enqueue before consumer is started
    ctrl.enqueueEpicDelete("E-X")
    expect(ctrl.getState().epicDeletePendingIds.size).toBe(0)

    await ctrl.stop()
  })

  test("epic delete and mark-ready queues are independent", async () => {
    markReadyCalls = []
    let epicDeleteCalls: string[] = []
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed([
          { id: "E-1", title: "Epic", status: "backlog" as const, labels: ["epic"] },
          { id: "T-1", title: "Task", status: "backlog" as const },
        ]),
        closeEpic: (id: string) => {
          epicDeleteCalls.push(id)
          return Effect.succeed({ removed: true, wasDirty: false })
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })
    await ctrl.refresh()
    await ctrl.startMarkReadyConsumer()
    await ctrl.startEpicDeleteConsumer()

    // Enqueue both operations
    ctrl.enqueueMarkReady("T-1", [])
    ctrl.enqueueEpicDelete("E-1")

    await waitFor(() => markReadyCalls.length >= 1 && epicDeleteCalls.length >= 1)

    // Both queues processed independently
    expect(markReadyCalls).toHaveLength(1)
    expect(markReadyCalls[0]!.id).toBe("T-1")
    expect(epicDeleteCalls).toHaveLength(1)
    expect(epicDeleteCalls[0]).toBe("E-1")

    await ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Distinct task-ready vs epic-delete actions
// ---------------------------------------------------------------------------

describe("TuiWatchController — distinct task-ready vs epic-delete actions", () => {
  test("enqueueMarkReady only affects markReadyPendingIds, not epicDeletePendingIds", async () => {
    const ctrl = makeController()
    await ctrl.startMarkReadyConsumer()

    ctrl.enqueueMarkReady("T-1", [])

    const state = ctrl.getState()
    expect(state.markReadyPendingIds.has("T-1")).toBe(true)
    expect(state.epicDeletePendingIds.size).toBe(0)

    await ctrl.stop()
  })

  test("enqueueEpicDelete only affects epicDeletePendingIds, not markReadyPendingIds", async () => {
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed([
          { id: "E-1", title: "Epic", status: "backlog" as const, labels: ["epic"] },
        ]),
      } as unknown as Partial<TuiWatchControllerDeps>,
    })
    await ctrl.refresh()
    await ctrl.startEpicDeleteConsumer()

    ctrl.enqueueEpicDelete("E-1")

    const state = ctrl.getState()
    expect(state.epicDeletePendingIds.has("E-1")).toBe(true)
    expect(state.markReadyPendingIds.size).toBe(0)

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

  test("stop() shuts down epic delete queue — enqueue after stop is a no-op", async () => {
    let deleteCallCount = 0
    const ctrl = makeController({
      deps: {
        queryAllTasks: () => Effect.succeed([
          { id: "E-1", title: "Epic", status: "backlog" as const, labels: ["epic"] },
        ]),
        closeEpic: () => {
          deleteCallCount++
          return Effect.succeed({ removed: true, wasDirty: false })
        },
      } as unknown as Partial<TuiWatchControllerDeps>,
    })
    await ctrl.refresh()
    await ctrl.startEpicDeleteConsumer()

    ctrl.enqueueEpicDelete("E-1")
    await waitFor(() => deleteCallCount >= 1)

    await ctrl.stop()

    // After stop, enqueue should be silently dropped
    ctrl.enqueueEpicDelete("E-POST")
    await flush()
    await new Promise((r) => setTimeout(r, 50))

    // No additional calls after stop
    expect(deleteCallCount).toBe(1)
  })
})
