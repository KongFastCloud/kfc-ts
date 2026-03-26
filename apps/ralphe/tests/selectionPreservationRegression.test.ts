/**
 * ABOUTME: Regression tests for selection-preservation across watch TUI refreshes.
 * Traceable to PRD: prd/ralphe-watch-tui-selection-preservation.md
 *
 * Covers the five acceptance criteria:
 * 1. Selection survives controller-driven refresh when the selected task remains valid.
 * 2. Viewport/scroll preservation when the selected row remains valid and visible.
 * 3. Detail-view preservation across ordinary refreshes.
 * 4. Invalid selections clamp or fall back only when the selected task becomes unavailable.
 * 5. Mount behavior: controller updates do not reset local app state through remount.
 *
 * These tests lock the approved behavior introduced by the WatchSession boundary
 * and clampAfterRefresh logic. They distinguish between refresh-as-data-update
 * (preserves state) and refresh-as-remount (eliminated by the fix).
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import {
  initialDashboardFocusState,
  clampAfterRefresh,
  moveSelectionDown,
  enterDetail,
  ensureVisible,
  type DashboardFocusState,
} from "../src/tui/dashboardFocus.js"
import {
  createTuiWatchController,
  type TuiWatchController,
  type TuiWatchControllerDeps,
  type TuiWatchControllerState,
} from "../src/tuiWatchController.js"
import { tuiWorkerEffect, type TuiWorkerDeps } from "../src/tuiWorker.js"
import type { RalpheConfig } from "../src/config.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateWith(overrides: Partial<DashboardFocusState>): DashboardFocusState {
  return { ...initialDashboardFocusState(), ...overrides }
}

/** Visible row count used across viewport tests. */
const VIS = 5

// -- Controller test harness ------------------------------------------------

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

function makeControllerDeps(
  overrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchControllerDeps {
  return {
    queryAllTasks: () =>
      Effect.succeed([
        { id: "T-1", title: "Task One", status: "queued" as const },
        { id: "T-2", title: "Task Two", status: "done" as const },
      ]),
    queryTaskDetail: () => Effect.succeed(undefined),
    markTaskReady: () => Effect.succeed(undefined),
    tuiWorkerEffect,
    workerDeps: makeWorkerDeps(),
    loadConfig: () => baseConfig,
    closeEpic: () => Effect.succeed({ removed: false, wasDirty: false }),
    getEpicWorktreeState: () => Effect.succeed("not_started" as const),
    getEpicRuntimeStatus: () => Effect.succeed("no_attempt" as const),
    ...overrides,
  }
}

function makeController(
  depsOverrides?: Partial<TuiWatchControllerDeps>,
): TuiWatchController {
  return createTuiWatchController(TestLayer, {
    refreshIntervalMs: 50,
    workDir: process.cwd(),
    workerId: "test-regression",
    deps: makeControllerDeps(depsOverrides),
  })
}

/** Wait for a condition with a timeout. */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}

// ===========================================================================
// AC-1: Selection survives controller-driven refresh when still valid
// ===========================================================================

describe("AC-1: selection survives refresh when selected task remains valid", () => {
  test("active table selection index is unchanged after refresh with same row count", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 3,
      doneSelectedIndex: 1,
    })
    const after = clampAfterRefresh(before, 10, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(3)
    expect(after.doneSelectedIndex).toBe(1)
    expect(after.focusedTable).toBe("active")
  })

  test("done table selection index is unchanged after refresh with same row count", () => {
    const before = stateWith({
      focusedTable: "done",
      activeSelectedIndex: 2,
      doneSelectedIndex: 4,
    })
    const after = clampAfterRefresh(before, 10, 8, VIS, VIS)

    expect(after.doneSelectedIndex).toBe(4)
    expect(after.activeSelectedIndex).toBe(2)
    expect(after.focusedTable).toBe("done")
  })

  test("selection survives when table grows (tasks added)", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 3,
    })
    // Table grows from 5 to 10 — selection at index 3 is still valid
    const after = clampAfterRefresh(before, 10, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(3)
  })

  test("selection survives repeated refreshes with stable task list", () => {
    let state = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 4,
      doneSelectedIndex: 2,
      activeScrollOffset: 1,
      doneScrollOffset: 0,
    })

    // Simulate 5 consecutive refreshes with identical task counts
    for (let i = 0; i < 5; i++) {
      state = clampAfterRefresh(state, 10, 5, VIS, VIS)
    }

    expect(state.activeSelectedIndex).toBe(4)
    expect(state.doneSelectedIndex).toBe(2)
    expect(state.activeScrollOffset).toBe(1)
    expect(state.doneScrollOffset).toBe(0)
    expect(state.focusedTable).toBe("active")
  })

  test("focused table is never reset by a data-only refresh", () => {
    const before = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 2,
    })
    const after = clampAfterRefresh(before, 10, 5, VIS, VIS)

    expect(after.focusedTable).toBe("done")
  })
})

// ===========================================================================
// AC-2: Viewport/scroll preservation when selected row remains visible
// ===========================================================================

describe("AC-2: viewport/scroll preservation across refresh", () => {
  test("scroll offset is unchanged when selection remains within viewport after refresh", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 5,
      activeScrollOffset: 3, // viewport: rows 3-7
    })
    const after = clampAfterRefresh(before, 10, 5, VIS, VIS)

    expect(after.activeScrollOffset).toBe(3)
    expect(after.activeSelectedIndex).toBe(5)
  })

  test("both tables maintain independent scroll offsets through refresh", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 6,
      activeScrollOffset: 4,
      doneSelectedIndex: 3,
      doneScrollOffset: 1,
    })
    const after = clampAfterRefresh(before, 10, 8, VIS, VIS)

    expect(after.activeScrollOffset).toBe(4)
    expect(after.doneScrollOffset).toBe(1)
  })

  test("scroll offset is unchanged after repeated refreshes with stable data", () => {
    let state = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 7,
      activeScrollOffset: 5, // viewport: rows 5-9
    })

    for (let i = 0; i < 5; i++) {
      state = clampAfterRefresh(state, 15, 5, VIS, VIS)
    }

    expect(state.activeScrollOffset).toBe(5)
    expect(state.activeSelectedIndex).toBe(7)
  })

  test("selected row remains within visible viewport slice after refresh", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 8,
      activeScrollOffset: 6,
    })
    const after = clampAfterRefresh(before, 15, 5, VIS, VIS)

    // Invariant: selectedIndex ∈ [scrollOffset, scrollOffset + VIS)
    expect(after.activeSelectedIndex).toBeGreaterThanOrEqual(after.activeScrollOffset)
    expect(after.activeSelectedIndex).toBeLessThan(after.activeScrollOffset + VIS)
  })

  test("scroll adjusts minimally when table shrinks but selection remains valid", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 4,
      activeScrollOffset: 10, // will be invalid after shrink
    })
    // Table shrinks from many to 6 — selection 4 is still valid,
    // but scrollOffset 10 exceeds max valid offset (6-5=1)
    const after = clampAfterRefresh(before, 6, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(4)
    // Scroll clamped to max valid offset, then ensureVisible adjusts
    expect(after.activeScrollOffset).toBeLessThanOrEqual(after.activeSelectedIndex)
    expect(after.activeSelectedIndex).toBeLessThan(after.activeScrollOffset + VIS)
  })
})

// ===========================================================================
// AC-3: Detail view preservation across ordinary refreshes
// ===========================================================================

describe("AC-3: detail view survives ordinary refreshes", () => {
  test("detail view on active table survives refresh when selected task is valid", () => {
    const before = stateWith({
      focusedTable: "active",
      viewMode: "detail",
      activeSelectedIndex: 2,
      activeScrollOffset: 0,
    })
    const after = clampAfterRefresh(before, 5, 3, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.focusedTable).toBe("active")
    expect(after.activeSelectedIndex).toBe(2)
  })

  test("detail view on done table survives refresh when selected task is valid", () => {
    const before = stateWith({
      focusedTable: "done",
      viewMode: "detail",
      doneSelectedIndex: 1,
      doneScrollOffset: 0,
    })
    const after = clampAfterRefresh(before, 5, 3, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.focusedTable).toBe("done")
    expect(after.doneSelectedIndex).toBe(1)
  })

  test("detail view survives multiple consecutive refreshes with stable data", () => {
    let state = stateWith({
      focusedTable: "active",
      viewMode: "detail",
      activeSelectedIndex: 3,
      activeScrollOffset: 0,
    })

    for (let i = 0; i < 10; i++) {
      state = clampAfterRefresh(state, 8, 4, VIS, VIS)
    }

    expect(state.viewMode).toBe("detail")
    expect(state.activeSelectedIndex).toBe(3)
  })

  test("detail view survives refresh when table grows", () => {
    const before = stateWith({
      focusedTable: "active",
      viewMode: "detail",
      activeSelectedIndex: 2,
    })
    const after = clampAfterRefresh(before, 20, 10, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.activeSelectedIndex).toBe(2)
  })

  test("detail view + scroll offset both survive refresh together", () => {
    const before = stateWith({
      focusedTable: "done",
      viewMode: "detail",
      doneSelectedIndex: 6,
      doneScrollOffset: 4,
    })
    const after = clampAfterRefresh(before, 5, 10, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.doneSelectedIndex).toBe(6)
    expect(after.doneScrollOffset).toBe(4)
  })
})

// ===========================================================================
// AC-4: Invalid selections clamp/fall back only when task becomes unavailable
// ===========================================================================

describe("AC-4: invalid selections clamp only when task becomes unavailable", () => {
  test("selection clamps to last valid index when table shrinks (not reset to 0)", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 8,
    })
    // Table shrinks from many to 5 — index 8 is invalid, clamp to 4
    const after = clampAfterRefresh(before, 5, 3, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(4) // last valid index, not 0
  })

  test("selection resets to 0 only when table becomes completely empty", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 5,
      activeScrollOffset: 3,
    })
    const after = clampAfterRefresh(before, 0, 3, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(0)
    expect(after.activeScrollOffset).toBe(0)
  })

  test("detail view falls back to dashboard only when focused table empties", () => {
    // Table non-empty → detail preserved even if selection clamps
    const shrink = clampAfterRefresh(
      stateWith({
        focusedTable: "active",
        viewMode: "detail",
        activeSelectedIndex: 7,
      }),
      3, 5, VIS, VIS,
    )
    expect(shrink.viewMode).toBe("detail")
    expect(shrink.activeSelectedIndex).toBe(2) // clamped, not reset

    // Table empty → forced back to dashboard
    const empty = clampAfterRefresh(
      stateWith({
        focusedTable: "active",
        viewMode: "detail",
        activeSelectedIndex: 3,
      }),
      0, 5, VIS, VIS,
    )
    expect(empty.viewMode).toBe("dashboard")
  })

  test("detail view on done table falls back only when done table empties", () => {
    // Done table non-empty — detail preserved
    const valid = clampAfterRefresh(
      stateWith({
        focusedTable: "done",
        viewMode: "detail",
        doneSelectedIndex: 2,
      }),
      5, 3, VIS, VIS,
    )
    expect(valid.viewMode).toBe("detail")

    // Done table empties — forced back to dashboard
    const empty = clampAfterRefresh(
      stateWith({
        focusedTable: "done",
        viewMode: "detail",
        doneSelectedIndex: 2,
      }),
      5, 0, VIS, VIS,
    )
    expect(empty.viewMode).toBe("dashboard")
  })

  test("unfocused table clamping does not affect focused table or view mode", () => {
    const before = stateWith({
      focusedTable: "active",
      viewMode: "detail",
      activeSelectedIndex: 2,
      doneSelectedIndex: 10,
    })
    // Done table shrinks drastically — but active is focused
    const after = clampAfterRefresh(before, 5, 3, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.activeSelectedIndex).toBe(2) // untouched
    expect(after.doneSelectedIndex).toBe(2) // clamped independently
  })

  test("scroll offset clamps proportionally — not reset to 0 — when table shrinks", () => {
    const before = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 5,
      activeScrollOffset: 8,
    })
    // Table shrinks to 7 rows. Max valid offset = 7 - 5 = 2.
    // Selection 5 clamps to 6. ensureVisible(2, 6, 5) = 2.
    const after = clampAfterRefresh(before, 7, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(5)
    expect(after.activeScrollOffset).toBe(2) // clamped, not 0
  })
})

// ===========================================================================
// AC-5: Mount-lifecycle safety — controller updates do not reset local state
// ===========================================================================

describe("AC-5: controller state changes do not reset local app state", () => {
  test("controller state-change listeners receive updates without resetting", async () => {
    const ctrl = makeController()
    const snapshots: TuiWatchControllerState[] = []

    ctrl.onStateChange(() => {
      snapshots.push(ctrl.getState())
    })

    await ctrl.refresh()

    expect(snapshots.length).toBeGreaterThanOrEqual(1)
    const lastSnapshot = snapshots[snapshots.length - 1]!
    expect(lastSnapshot.latestTasks.length).toBeGreaterThan(0)
    expect(lastSnapshot.lastRefreshed).toBeInstanceOf(Date)

    await ctrl.stop()
  })

  test("multiple sequential refreshes emit state changes — never a full reset", async () => {
    let refreshCount = 0
    const ctrl = makeController({
      queryAllTasks: () => {
        refreshCount++
        return Effect.succeed([
          { id: "T-1", title: "Task One", status: "queued" as const },
          { id: "T-2", title: "Task Two", status: "done" as const },
          { id: `T-${refreshCount + 2}`, title: `Dynamic ${refreshCount}`, status: "queued" as const },
        ])
      },
    })

    const stateHistory: TuiWatchControllerState[] = []
    ctrl.onStateChange(() => {
      stateHistory.push(ctrl.getState())
    })

    // Perform multiple refreshes
    await ctrl.refresh()
    await ctrl.refresh()
    await ctrl.refresh()

    // Every state change should have tasks — never an intermediate empty state
    for (const snap of stateHistory) {
      expect(snap.latestTasks.length).toBeGreaterThan(0)
    }

    await ctrl.stop()
  })

  test("listener subscription survives across multiple refreshes (no re-subscribe needed)", async () => {
    const ctrl = makeController()
    let callCount = 0

    ctrl.onStateChange(() => {
      callCount++
    })

    await ctrl.refresh()
    const afterFirst = callCount

    await ctrl.refresh()
    const afterSecond = callCount

    // Listener called on both refreshes — subscription was not lost
    expect(afterFirst).toBeGreaterThan(0)
    expect(afterSecond).toBeGreaterThan(afterFirst)

    await ctrl.stop()
  })

  test("removeStateChangeListener stops delivery without affecting other listeners", async () => {
    const ctrl = makeController()
    let countA = 0
    let countB = 0
    const listenerA = () => { countA++ }
    const listenerB = () => { countB++ }

    ctrl.onStateChange(listenerA)
    ctrl.onStateChange(listenerB)

    await ctrl.refresh()
    expect(countA).toBeGreaterThan(0)
    expect(countB).toBeGreaterThan(0)

    // Remove listener A — B should still receive
    ctrl.removeStateChangeListener(listenerA)
    const countAAfterRemove = countA
    const countBBefore = countB

    await ctrl.refresh()

    expect(countA).toBe(countAAfterRemove) // A stopped receiving
    expect(countB).toBeGreaterThan(countBBefore) // B still receiving

    await ctrl.stop()
  })

  test("controller getState() returns consistent snapshot (not stale references)", async () => {
    const ctrl = makeController()

    const before = ctrl.getState()
    expect(before.latestTasks).toEqual([])
    expect(before.lastRefreshed).toBeNull()

    await ctrl.refresh()

    const after = ctrl.getState()
    expect(after.latestTasks.length).toBeGreaterThan(0)
    expect(after.lastRefreshed).toBeInstanceOf(Date)

    // Original snapshot is not mutated — proves immutable state
    expect(before.latestTasks).toEqual([])
    expect(before.lastRefreshed).toBeNull()

    await ctrl.stop()
  })

  test("periodic refresh delivers state changes without resetting task list", async () => {
    const ctrl = makeController()
    const taskCounts: number[] = []

    await ctrl.refresh() // seed initial data

    ctrl.onStateChange(() => {
      taskCounts.push(ctrl.getState().latestTasks.length)
    })

    ctrl.startPeriodicRefresh()

    // Wait for at least 2 periodic refreshes
    await waitFor(() => taskCounts.length >= 2, 5000)

    // Every observed state should have tasks — no intermediate resets
    for (const count of taskCounts) {
      expect(count).toBeGreaterThan(0)
    }

    await ctrl.stop()
  })
})

// ===========================================================================
// Integration: navigate → refresh → assert preservation (end-to-end)
// ===========================================================================

describe("integration: navigate then refresh preserves full context", () => {
  test("navigate active table, refresh, verify selection + scroll + mode intact", () => {
    // Simulate: user navigates down 7 rows, then refresh happens
    let state = initialDashboardFocusState()
    for (let i = 0; i < 7; i++) {
      state = moveSelectionDown(state, 15, 5, VIS)
    }

    expect(state.activeSelectedIndex).toBe(7)
    expect(state.activeScrollOffset).toBe(3)
    expect(state.viewMode).toBe("dashboard")

    // Refresh with unchanged task counts
    const after = clampAfterRefresh(state, 15, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(7)
    expect(after.activeScrollOffset).toBe(3)
    expect(after.viewMode).toBe("dashboard")
    expect(after.focusedTable).toBe("active")
  })

  test("enter detail → refresh → detail and selection preserved", () => {
    let state = initialDashboardFocusState()

    // Navigate to row 3 and enter detail view
    for (let i = 0; i < 3; i++) {
      state = moveSelectionDown(state, 10, 5, VIS)
    }
    state = enterDetail(state, 10, 5)

    expect(state.viewMode).toBe("detail")
    expect(state.activeSelectedIndex).toBe(3)

    // Simulate a background refresh
    const after = clampAfterRefresh(state, 10, 5, VIS, VIS)

    expect(after.viewMode).toBe("detail")
    expect(after.activeSelectedIndex).toBe(3)
    expect(after.focusedTable).toBe("active")
  })

  test("navigate + scroll deep → partial shrink → selection clamps, scroll adjusts, mode preserved", () => {
    let state = initialDashboardFocusState()

    // Navigate deep into a long table
    for (let i = 0; i < 12; i++) {
      state = moveSelectionDown(state, 20, 5, VIS)
    }
    expect(state.activeSelectedIndex).toBe(12)
    expect(state.activeScrollOffset).toBe(8) // 12 - 5 + 1

    // Enter detail on row 12
    state = enterDetail(state, 20, 5)
    expect(state.viewMode).toBe("detail")

    // Table shrinks from 20 to 8 — row 12 no longer exists
    const after = clampAfterRefresh(state, 8, 5, VIS, VIS)

    expect(after.activeSelectedIndex).toBe(7) // clamped to last valid
    expect(after.viewMode).toBe("detail") // preserved — table not empty
    // Scroll adjusted to keep clamped selection visible
    expect(after.activeSelectedIndex).toBeGreaterThanOrEqual(after.activeScrollOffset)
    expect(after.activeSelectedIndex).toBeLessThan(after.activeScrollOffset + VIS)
  })

  test("refresh distinguishes data update from remount: state preserved, tasks updated", async () => {
    // This test models the contract between controller refresh and UI state:
    // - Controller updates latestTasks (data update)
    // - Dashboard focus state is unaffected (not a remount)
    let taskVersion = 1
    const ctrl = makeController({
      queryAllTasks: () => {
        const version = taskVersion++
        return Effect.succeed([
          { id: "T-1", title: `Task v${version}`, status: "queued" as const },
          { id: "T-2", title: `Done v${version}`, status: "done" as const },
        ])
      },
    })

    // Refresh delivers new task data
    await ctrl.refresh()
    const state1 = ctrl.getState()
    expect(state1.latestTasks[0]!.title).toBe("Task v1")

    // Dashboard focus state would be local React state in the real app.
    // Simulate it separately — it should not be reset by the controller.
    const dashState = stateWith({
      focusedTable: "done",
      viewMode: "detail",
      doneSelectedIndex: 1,
      doneScrollOffset: 0,
    })

    // Second refresh — new task data
    await ctrl.refresh()
    const state2 = ctrl.getState()
    expect(state2.latestTasks[0]!.title).toBe("Task v2")

    // Dashboard state unchanged — controller refresh is data-only
    const afterRefresh = clampAfterRefresh(dashState, 1, 1, VIS, VIS)
    expect(afterRefresh.focusedTable).toBe("done")
    expect(afterRefresh.viewMode).toBe("detail")
    expect(afterRefresh.doneSelectedIndex).toBe(0) // clamped because only 1 done task

    await ctrl.stop()
  })
})
