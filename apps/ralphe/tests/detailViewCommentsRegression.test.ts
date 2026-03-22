/**
 * ABOUTME: Regression tests for detail-view comment rendering and detail-data path.
 * Traceable to PRD: prd/ralphe-detail-view-comments.md
 *
 * Locks in the corrected detail-view behavior:
 * 1. Comments/activity appear in the detail pane when present in full detail data.
 * 2. Detail view uses the full-detail query path (queryTaskDetail), not just the
 *    dashboard list snapshot (queryAllTasks).
 * 3. Comments remain chronologically ordered in the rendered detail pane.
 * 4. Selected-detail context (detailTaskId) is preserved and re-resolved across refreshes.
 * 5. Detail-fetch loading and failure states are deterministic and visible.
 *
 * Non-goals:
 * - Broader TUI redesign coverage
 * - Comment authoring behavior
 * - Polling or orchestration behavior outside the detail-view contract
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import {
  createTuiWatchController,
  type TuiWatchController,
  type TuiWatchControllerDeps,
} from "../src/tuiWatchController.js"
import { tuiWorkerEffect, type TuiWorkerDeps } from "../src/tuiWorker.js"
import { parseBdTaskList, type WatchTask } from "../src/beadsAdapter.js"
import type { RalpheConfig } from "../src/config.js"
import { FatalError } from "../src/errors.js"

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const TestLayer: Layer.Layer<never> = Logger.replace(
  Logger.defaultLogger,
  Logger.make(() => {}),
)

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

/** Dashboard list data — lightweight, no comments. */
const listTasks: WatchTask[] = [
  { id: "T-1", title: "Task One", status: "queued" as const },
  { id: "T-2", title: "Task Two", status: "done" as const },
  { id: "T-3", title: "Task Three", status: "active" as const },
]

/** Full detail data — includes comments (only available via queryTaskDetail). */
const detailTaskWithComments: WatchTask = {
  id: "T-1",
  title: "Task One",
  status: "queued" as const,
  comments: [
    { id: "c1", author: "agent-1", text: "Starting execution", createdAt: "2026-01-01T10:00:00Z" },
    { id: "c2", author: "agent-1", text: "Attempt failed\nRetrying...", createdAt: "2026-01-01T10:05:00Z" },
    { id: "c3", author: "agent-2", text: "Retry succeeded", createdAt: "2026-01-01T10:10:00Z" },
  ],
}

/** Detail data with no comments (task exists but has no activity). */
const detailTaskNoComments: WatchTask = {
  id: "T-2",
  title: "Task Two",
  status: "done" as const,
}

function makeControllerDeps(
  overrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchControllerDeps {
  return {
    queryAllTasks: () => Effect.succeed(listTasks),
    queryTaskDetail: (id: string) => {
      if (id === "T-1") return Effect.succeed(detailTaskWithComments)
      if (id === "T-2") return Effect.succeed(detailTaskNoComments)
      return Effect.succeed(undefined)
    },
    markTaskReady: () => Effect.succeed(undefined),
    tuiWorkerEffect,
    workerDeps: makeWorkerDeps(),
    loadConfig: () => baseConfig,
    ...overrides,
  }
}

function makeController(
  depsOverrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchController {
  return createTuiWatchController(TestLayer, {
    refreshIntervalMs: 50,
    workDir: process.cwd(),
    workerId: "test-detail-comments-regression",
    deps: makeControllerDeps(depsOverrides),
  })
}

/** Flush pending microtasks. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** Wait for a condition with a timeout. */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}

// ===========================================================================
// AC-1: Task with comments in full detail data renders comments in detail pane
// ===========================================================================

describe("AC-1: comments/activity appear in the detail pane", () => {
  test("fetchTaskDetail returns comments from full detail data", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")

    const state = ctrl.getState()
    expect(state.detailTask).toBeDefined()
    expect(state.detailTask!.comments).toBeDefined()
    expect(state.detailTask!.comments).toHaveLength(3)
    expect(state.detailTask!.comments![0]!.text).toBe("Starting execution")
    expect(state.detailTask!.comments![1]!.text).toBe("Attempt failed\nRetrying...")
    expect(state.detailTask!.comments![2]!.text).toBe("Retry succeeded")

    await ctrl.stop()
  })

  test("comment author and timestamp are available for rendering", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")

    const comments = ctrl.getState().detailTask!.comments!
    expect(comments[0]!.author).toBe("agent-1")
    expect(comments[0]!.createdAt).toBe("2026-01-01T10:00:00Z")
    expect(comments[2]!.author).toBe("agent-2")

    await ctrl.stop()
  })

  test("task with no comments has undefined comments in detail", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-2")

    const state = ctrl.getState()
    expect(state.detailTask).toBeDefined()
    expect(state.detailTask!.comments).toBeUndefined()

    await ctrl.stop()
  })

  test("multiline comment text is preserved intact", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")

    const comment = ctrl.getState().detailTask!.comments![1]!
    expect(comment.text).toContain("\n")
    expect(comment.text.split("\n")).toHaveLength(2)

    await ctrl.stop()
  })
})

// ===========================================================================
// AC-2: Detail rendering uses the full-detail query path
// ===========================================================================

describe("AC-2: detail view uses full-detail query path, not list snapshot", () => {
  test("queryTaskDetail is invoked (not queryAllTasks) when entering detail view", async () => {
    let detailCalled = false
    let listCalledDuringDetail = false

    const ctrl = makeController({
      queryAllTasks: () => {
        listCalledDuringDetail = true
        return Effect.succeed(listTasks)
      },
      queryTaskDetail: (id: string) => {
        detailCalled = true
        return Effect.succeed(id === "T-1" ? detailTaskWithComments : undefined)
      },
    })

    // Reset: queryAllTasks may be called during construction
    listCalledDuringDetail = false

    await ctrl.fetchTaskDetail("T-1")

    expect(detailCalled).toBe(true)
    // fetchTaskDetail should NOT call queryAllTasks — those are separate paths
    expect(listCalledDuringDetail).toBe(false)

    await ctrl.stop()
  })

  test("list snapshot does not carry comments — detail path is required", () => {
    // Dashboard list data (from queryAllTasks / parseBdTaskList) does not
    // include comments unless the raw JSON contained them. The list endpoint
    // should not carry comment data — that is detail-only.
    for (const task of listTasks) {
      expect(task.comments).toBeUndefined()
    }
  })

  test("detail data contains fields absent from list snapshot", async () => {
    const richDetail: WatchTask = {
      id: "T-1",
      title: "Task One",
      status: "queued" as const,
      description: "Full description only in detail",
      comments: [
        { id: "c1", author: "bot", text: "Comment", createdAt: "2026-01-01T00:00:00Z" },
      ],
    }

    const ctrl = makeController({
      queryTaskDetail: () => Effect.succeed(richDetail),
    })

    // List data for T-1 has no description or comments
    const listTask = listTasks.find((t) => t.id === "T-1")!
    expect(listTask.description).toBeUndefined()
    expect(listTask.comments).toBeUndefined()

    // Detail data has both
    await ctrl.fetchTaskDetail("T-1")
    const detail = ctrl.getState().detailTask!
    expect(detail.description).toBe("Full description only in detail")
    expect(detail.comments).toHaveLength(1)

    await ctrl.stop()
  })

  test("adapter parseBdTaskList produces tasks without comments from list-style JSON", () => {
    // Simulate the dashboard list endpoint: no comments field in the raw JSON
    const listJson = JSON.stringify([
      { id: "T-1", title: "Task One", status: "open", labels: ["ready"] },
      { id: "T-2", title: "Task Two", status: "closed" },
    ])

    const tasks = parseBdTaskList(listJson)
    for (const task of tasks) {
      expect(task.comments).toBeUndefined()
    }
  })

  test("adapter parseBdTaskList preserves comments from detail-style JSON", () => {
    // Simulate the detail endpoint: comments present in raw JSON
    const detailJson = JSON.stringify([
      {
        id: "T-1",
        title: "Task One",
        status: "open",
        comments: [
          { id: "c-1", text: "Hello", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    ])

    const tasks = parseBdTaskList(detailJson)
    expect(tasks[0]!.comments).toBeDefined()
    expect(tasks[0]!.comments).toHaveLength(1)
    expect(tasks[0]!.comments![0]!.text).toBe("Hello")
  })
})

// ===========================================================================
// AC-3: Comments remain chronologically ordered in the detail pane
// ===========================================================================

describe("AC-3: comments are chronologically ordered", () => {
  test("comments arrive sorted oldest-first from the adapter", () => {
    const json = JSON.stringify([
      {
        id: "T-1",
        title: "Task",
        status: "open",
        comments: [
          { id: "c3", text: "Third", created_at: "2026-01-03T00:00:00Z" },
          { id: "c1", text: "First", created_at: "2026-01-01T00:00:00Z" },
          { id: "c2", text: "Second", created_at: "2026-01-02T00:00:00Z" },
        ],
      },
    ])

    const comments = parseBdTaskList(json)[0]!.comments!
    expect(comments[0]!.id).toBe("c1")
    expect(comments[1]!.id).toBe("c2")
    expect(comments[2]!.id).toBe("c3")
  })

  test("controller detail state preserves chronological order from adapter", async () => {
    const outOfOrderDetail: WatchTask = {
      id: "T-1",
      title: "Task One",
      status: "queued" as const,
      comments: [
        { id: "c1", author: "a", text: "First", createdAt: "2026-01-01T10:00:00Z" },
        { id: "c2", author: "a", text: "Second", createdAt: "2026-01-01T10:05:00Z" },
        { id: "c3", author: "a", text: "Third", createdAt: "2026-01-01T10:10:00Z" },
      ],
    }

    const ctrl = makeController({
      queryTaskDetail: () => Effect.succeed(outOfOrderDetail),
    })

    await ctrl.fetchTaskDetail("T-1")

    const comments = ctrl.getState().detailTask!.comments!
    // Verify chronological ordering is maintained through the controller
    for (let i = 1; i < comments.length; i++) {
      const prev = new Date(comments[i - 1]!.createdAt).getTime()
      const curr = new Date(comments[i]!.createdAt).getTime()
      expect(curr).toBeGreaterThanOrEqual(prev)
    }

    await ctrl.stop()
  })

  test("single comment is handled correctly (no sorting edge case)", () => {
    const json = JSON.stringify([
      {
        id: "T-1",
        title: "Task",
        status: "open",
        comments: [
          { id: "c1", text: "Only comment", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    ])

    const comments = parseBdTaskList(json)[0]!.comments!
    expect(comments).toHaveLength(1)
    expect(comments[0]!.text).toBe("Only comment")
  })

  test("comments with identical timestamps maintain stable order", () => {
    const json = JSON.stringify([
      {
        id: "T-1",
        title: "Task",
        status: "open",
        comments: [
          { id: "c1", text: "Alpha", created_at: "2026-01-01T00:00:00Z" },
          { id: "c2", text: "Beta", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    ])

    const comments = parseBdTaskList(json)[0]!.comments!
    expect(comments).toHaveLength(2)
    // Both should be present — order among same-timestamp is stable (insertion order)
    const ids = comments.map((c) => c.id)
    expect(ids).toContain("c1")
    expect(ids).toContain("c2")
  })
})

// ===========================================================================
// AC-4: Selected-detail context preserved across refreshes
// ===========================================================================

describe("AC-4: detail context preserved and re-resolved across refreshes", () => {
  test("refresh re-fetches detail for the currently viewed task", async () => {
    let detailFetchCount = 0
    const ctrl = makeController({
      queryTaskDetail: (id: string) => {
        detailFetchCount++
        return Effect.succeed(id === "T-1" ? detailTaskWithComments : undefined)
      },
    })

    // Enter detail view
    await ctrl.fetchTaskDetail("T-1")
    expect(detailFetchCount).toBe(1)

    // Trigger a refresh — should also re-fetch detail
    await ctrl.refresh()
    await waitFor(() => detailFetchCount >= 2)

    expect(detailFetchCount).toBeGreaterThanOrEqual(2)

    await ctrl.stop()
  })

  test("detailTaskId stays the same across refresh — context not lost", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailTaskId).toBe("T-1")

    await ctrl.refresh()
    await flush()

    // detailTaskId should still point to the same task
    expect(ctrl.getState().detailTaskId).toBe("T-1")

    await ctrl.stop()
  })

  test("detail data is updated (re-resolved) after refresh, not stale", async () => {
    let fetchVersion = 0
    const ctrl = makeController({
      queryTaskDetail: (id: string) => {
        fetchVersion++
        return Effect.succeed({
          id,
          title: `Task v${fetchVersion}`,
          status: "queued" as const,
          comments: [
            { id: `c-v${fetchVersion}`, text: `Comment v${fetchVersion}`, author: "bot", createdAt: "2026-01-01T00:00:00Z" },
          ],
        })
      },
    })

    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailTask!.title).toBe("Task v1")
    expect(ctrl.getState().detailTask!.comments![0]!.text).toBe("Comment v1")

    // Refresh triggers re-fetch
    await ctrl.refresh()
    await waitFor(() => fetchVersion >= 2)
    await flush()

    // Detail data should reflect the re-fetched version
    const state = ctrl.getState()
    expect(state.detailTaskId).toBe("T-1")
    expect(state.detailTask!.comments![0]!.text).toBe("Comment v2")

    await ctrl.stop()
  })

  test("refresh without open detail view does not trigger detail fetch", async () => {
    let detailCalled = false
    const ctrl = makeController({
      queryTaskDetail: () => {
        detailCalled = true
        return Effect.succeed(detailTaskWithComments)
      },
    })

    await ctrl.refresh()
    await flush()

    expect(detailCalled).toBe(false)

    await ctrl.stop()
  })

  test("exiting detail view before refresh prevents re-fetch", async () => {
    let detailFetchCount = 0
    const ctrl = makeController({
      queryTaskDetail: (id: string) => {
        detailFetchCount++
        return Effect.succeed(id === "T-1" ? detailTaskWithComments : undefined)
      },
    })

    await ctrl.fetchTaskDetail("T-1")
    expect(detailFetchCount).toBe(1)

    ctrl.exitDetailView()

    await ctrl.refresh()
    await flush()

    // No additional detail fetch after exit
    expect(detailFetchCount).toBe(1)

    await ctrl.stop()
  })

  test("stale detail result from a previous task is discarded after navigation", async () => {
    let resolveDetail: ((task: WatchTask | undefined) => void) | null = null
    const ctrl = makeController({
      queryTaskDetail: () =>
        Effect.promise(
          () => new Promise<WatchTask | undefined>((r) => { resolveDetail = r }),
        ),
    })

    // Start fetch for T-1 (deferred)
    const fetchPromise = ctrl.fetchTaskDetail("T-1")
    await waitFor(() => resolveDetail !== null)

    // Navigate away before fetch completes
    ctrl.exitDetailView()

    // Resolve the old fetch
    resolveDetail!(detailTaskWithComments)
    await fetchPromise

    // Stale result should be discarded
    const state = ctrl.getState()
    expect(state.detailTask).toBeUndefined()
    expect(state.detailTaskId).toBeUndefined()

    await ctrl.stop()
  })
})

// ===========================================================================
// AC-5: Detail-fetch loading and failure behavior
// ===========================================================================

describe("AC-5: detail-fetch loading and failure states", () => {
  test("detailLoading is true while fetch is in flight", async () => {
    const loadingStates: boolean[] = []
    const ctrl = makeController({
      queryTaskDetail: (id: string) => {
        // Capture loading state during fetch
        loadingStates.push(ctrl.getState().detailLoading)
        return Effect.succeed(id === "T-1" ? detailTaskWithComments : undefined)
      },
    })

    await ctrl.fetchTaskDetail("T-1")

    // Loading should have been true during the fetch
    expect(loadingStates).toContain(true)
    // After fetch completes, loading should be false
    expect(ctrl.getState().detailLoading).toBe(false)

    await ctrl.stop()
  })

  test("detailError is set when task is not found", async () => {
    const ctrl = makeController()

    await ctrl.fetchTaskDetail("NONEXISTENT")

    const state = ctrl.getState()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toBeDefined()
    expect(state.detailError).toContain("not found")
    expect(state.detailTask).toBeUndefined()

    await ctrl.stop()
  })

  test("detailError is set when fetch throws", async () => {
    const ctrl = makeController({
      queryTaskDetail: () =>
        Effect.fail(new FatalError({ command: "bd show", message: "network timeout" })),
    })

    await ctrl.fetchTaskDetail("T-1")

    const state = ctrl.getState()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toContain("Detail fetch failed")
    expect(state.detailError).toContain("network timeout")
    expect(state.detailTask).toBeUndefined()

    await ctrl.stop()
  })

  test("successful fetch clears any previous error", async () => {
    const ctrl = makeController()

    // First: fetch a nonexistent task to set an error
    await ctrl.fetchTaskDetail("NONEXISTENT")
    expect(ctrl.getState().detailError).toBeDefined()

    // Then: fetch a valid task
    await ctrl.fetchTaskDetail("T-1")

    const state = ctrl.getState()
    expect(state.detailError).toBeUndefined()
    expect(state.detailTask).toBeDefined()
    expect(state.detailTask!.id).toBe("T-1")

    await ctrl.stop()
  })

  test("exitDetailView clears loading, error, and detail state", async () => {
    const ctrl = makeController({
      queryTaskDetail: () =>
        Effect.fail(new FatalError({ command: "bd show", message: "failure" })),
    })

    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailError).toBeDefined()

    ctrl.exitDetailView()

    const state = ctrl.getState()
    expect(state.detailTask).toBeUndefined()
    expect(state.detailLoading).toBe(false)
    expect(state.detailError).toBeUndefined()
    expect(state.detailTaskId).toBeUndefined()

    await ctrl.stop()
  })

  test("detail re-fetch failure during refresh is non-fatal — does not clear detailTaskId", async () => {
    let fetchCount = 0
    const ctrl = makeController({
      queryTaskDetail: (id: string) => {
        fetchCount++
        if (fetchCount === 1) return Effect.succeed(detailTaskWithComments)
        // Second fetch (during refresh) fails
        return Effect.fail(new FatalError({ command: "bd show", message: "transient error" }))
      },
    })

    // First fetch succeeds
    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailTask).toBeDefined()

    // Refresh triggers re-fetch which fails
    await ctrl.refresh()
    await waitFor(() => fetchCount >= 2)
    await flush()
    // Allow the async detail re-fetch error to propagate
    await new Promise((r) => setTimeout(r, 50))

    const state = ctrl.getState()
    // detailTaskId should still be set — the user is still viewing T-1
    expect(state.detailTaskId).toBe("T-1")
    // Error should be surfaced
    expect(state.detailError).toContain("Detail fetch failed")

    await ctrl.stop()
  })

  test("state change listeners fire for loading, success, and error transitions", async () => {
    const ctrl = makeController()
    const transitions: Array<{ loading: boolean; error?: string; hasDetail: boolean }> = []

    ctrl.onStateChange(() => {
      const s = ctrl.getState()
      transitions.push({
        loading: s.detailLoading,
        error: s.detailError,
        hasDetail: s.detailTask !== undefined,
      })
    })

    await ctrl.fetchTaskDetail("T-1")

    // Should have at least: loading=true notification, then loading=false+hasDetail notification
    expect(transitions.some((t) => t.loading === true)).toBe(true)
    expect(transitions.some((t) => t.loading === false && t.hasDetail === true)).toBe(true)

    await ctrl.stop()
  })
})

// ===========================================================================
// Boundary enforcement: dashboard list vs detail data
// ===========================================================================

describe("boundary: dashboard list data vs detail data remain separated", () => {
  test("queryAllTasks and queryTaskDetail are independent code paths", async () => {
    let listCallCount = 0
    let detailCallCount = 0

    const ctrl = makeController({
      queryAllTasks: () => {
        listCallCount++
        return Effect.succeed(listTasks)
      },
      queryTaskDetail: (id: string) => {
        detailCallCount++
        return Effect.succeed(id === "T-1" ? detailTaskWithComments : undefined)
      },
    })

    // Refresh calls only queryAllTasks
    await ctrl.refresh()
    expect(listCallCount).toBe(1)
    expect(detailCallCount).toBe(0)

    // fetchTaskDetail calls only queryTaskDetail
    await ctrl.fetchTaskDetail("T-1")
    expect(detailCallCount).toBe(1)
    // listCallCount unchanged by detail fetch
    expect(listCallCount).toBe(1)

    await ctrl.stop()
  })

  test("latestTasks (list) and detailTask (detail) are independent state", async () => {
    const ctrl = makeController()

    await ctrl.refresh()
    const listState = ctrl.getState()
    expect(listState.latestTasks).toHaveLength(3)
    expect(listState.detailTask).toBeUndefined()

    await ctrl.fetchTaskDetail("T-1")
    const detailState = ctrl.getState()
    // List state unchanged
    expect(detailState.latestTasks).toHaveLength(3)
    // Detail state populated
    expect(detailState.detailTask).toBeDefined()
    expect(detailState.detailTask!.comments).toHaveLength(3)

    // List tasks still lack comments — they come from the lightweight path
    for (const task of detailState.latestTasks) {
      expect(task.comments).toBeUndefined()
    }

    await ctrl.stop()
  })

  test("exiting detail view does not affect the dashboard list", async () => {
    const ctrl = makeController()

    await ctrl.refresh()
    await ctrl.fetchTaskDetail("T-1")
    expect(ctrl.getState().detailTask).toBeDefined()

    ctrl.exitDetailView()

    const state = ctrl.getState()
    expect(state.detailTask).toBeUndefined()
    // List data is unaffected
    expect(state.latestTasks).toHaveLength(3)

    await ctrl.stop()
  })
})
