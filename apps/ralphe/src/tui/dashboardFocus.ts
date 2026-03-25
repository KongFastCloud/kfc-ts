/**
 * ABOUTME: Pure dashboard focus, selection, and viewport state logic.
 * Extracted from WatchApp for testability. Contains the state shape,
 * initial state factory, and all state transition functions for
 * dashboard table focus, per-table selection, per-table scroll offset,
 * and view mode.
 *
 * Supports three focusable panes: active tasks (primary), done tasks,
 * and epic pane (secondary). Tab cycles through all three panes.
 */

import type { FocusedTable } from "./DashboardView.js"

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface DashboardFocusState {
  /** Which table currently holds focus. */
  focusedTable: FocusedTable
  /** Selected row index within the active (top) table. */
  activeSelectedIndex: number
  /** Selected row index within the done (bottom) table. */
  doneSelectedIndex: number
  /** Scroll offset (first visible row) for the active (top) table. */
  activeScrollOffset: number
  /** Scroll offset (first visible row) for the done (bottom) table. */
  doneScrollOffset: number
  /** Selected row index within the epic pane. */
  epicSelectedIndex: number
  /** Scroll offset (first visible row) for the epic pane. */
  epicScrollOffset: number
  /** Current view mode. */
  viewMode: "dashboard" | "detail"
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** Initial dashboard state: top table focused, first row selected, scroll at top. */
export function initialDashboardFocusState(): DashboardFocusState {
  return {
    focusedTable: "active",
    activeSelectedIndex: 0,
    doneSelectedIndex: 0,
    activeScrollOffset: 0,
    doneScrollOffset: 0,
    epicSelectedIndex: 0,
    epicScrollOffset: 0,
    viewMode: "dashboard",
  }
}

// ---------------------------------------------------------------------------
// Viewport helpers
// ---------------------------------------------------------------------------

/**
 * Adjust scroll offset so the selected row is visible. Scrolls minimally:
 * - If above the viewport, snap viewport top to the selected row.
 * - If below the viewport, scroll down just enough to reveal it.
 * - If already visible, leave the offset unchanged.
 *
 * When visibleRowCount is <= 0, returns 0 (degenerate viewport).
 */
export function ensureVisible(
  scrollOffset: number,
  selectedIndex: number,
  visibleRowCount: number,
): number {
  if (visibleRowCount <= 0) return 0
  // Selection above viewport
  if (selectedIndex < scrollOffset) return selectedIndex
  // Selection below viewport
  if (selectedIndex >= scrollOffset + visibleRowCount) {
    return selectedIndex - visibleRowCount + 1
  }
  // Already visible
  return scrollOffset
}

/**
 * Clamp a scroll offset to its valid range [0, max(0, rowCount - visibleRowCount)].
 * When the entire table fits, the offset is always 0.
 */
export function clampScrollOffset(
  scrollOffset: number,
  rowCount: number,
  visibleRowCount: number,
): number {
  if (visibleRowCount <= 0 || rowCount <= visibleRowCount) return 0
  return Math.max(0, Math.min(scrollOffset, rowCount - visibleRowCount))
}

// ---------------------------------------------------------------------------
// Focus cycle order
// ---------------------------------------------------------------------------

/** Tab-cycle order for pane focus. */
const FOCUS_CYCLE: readonly FocusedTable[] = ["active", "done", "epic"]

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Cycle focused pane (Tab key).
 * Cycles: active → done → epic → active.
 */
export function toggleFocusedTable(state: DashboardFocusState): DashboardFocusState {
  const idx = FOCUS_CYCLE.indexOf(state.focusedTable)
  const next = FOCUS_CYCLE[(idx + 1) % FOCUS_CYCLE.length]!
  return { ...state, focusedTable: next }
}

/** Move selection up within the focused table. Adjusts scroll offset if needed. */
export function moveSelectionUp(
  state: DashboardFocusState,
  visibleRowCount: number,
): DashboardFocusState {
  if (state.focusedTable === "active") {
    const newIndex = Math.max(0, state.activeSelectedIndex - 1)
    return {
      ...state,
      activeSelectedIndex: newIndex,
      activeScrollOffset: ensureVisible(state.activeScrollOffset, newIndex, visibleRowCount),
    }
  }
  if (state.focusedTable === "done") {
    const newIndex = Math.max(0, state.doneSelectedIndex - 1)
    return {
      ...state,
      doneSelectedIndex: newIndex,
      doneScrollOffset: ensureVisible(state.doneScrollOffset, newIndex, visibleRowCount),
    }
  }
  // epic
  const newIndex = Math.max(0, state.epicSelectedIndex - 1)
  return {
    ...state,
    epicSelectedIndex: newIndex,
    epicScrollOffset: ensureVisible(state.epicScrollOffset, newIndex, visibleRowCount),
  }
}

/** Move selection down within the focused table. Adjusts scroll offset if needed. */
export function moveSelectionDown(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
  visibleRowCount: number,
  epicCount?: number,
): DashboardFocusState {
  if (state.focusedTable === "active") {
    const newIndex =
      activeCount === 0 ? 0 : Math.min(activeCount - 1, state.activeSelectedIndex + 1)
    return {
      ...state,
      activeSelectedIndex: newIndex,
      activeScrollOffset: ensureVisible(state.activeScrollOffset, newIndex, visibleRowCount),
    }
  }
  if (state.focusedTable === "done") {
    const newIndex =
      doneCount === 0 ? 0 : Math.min(doneCount - 1, state.doneSelectedIndex + 1)
    return {
      ...state,
      doneSelectedIndex: newIndex,
      doneScrollOffset: ensureVisible(state.doneScrollOffset, newIndex, visibleRowCount),
    }
  }
  // epic
  const count = epicCount ?? 0
  const newIndex =
    count === 0 ? 0 : Math.min(count - 1, state.epicSelectedIndex + 1)
  return {
    ...state,
    epicSelectedIndex: newIndex,
    epicScrollOffset: ensureVisible(state.epicScrollOffset, newIndex, visibleRowCount),
  }
}

/**
 * Attempt to enter detail view (Enter key).
 * Returns unchanged state if the focused table is empty.
 * Epic pane does not support detail view — returns unchanged state.
 */
export function enterDetail(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
): DashboardFocusState {
  // Epic pane does not support detail drill-down
  if (state.focusedTable === "epic") return state
  const tableLen = state.focusedTable === "active" ? activeCount : doneCount
  if (tableLen === 0) return state
  return { ...state, viewMode: "detail" }
}

/**
 * Return from detail to dashboard.
 * Resets focus to top table and first row.
 */
export function returnFromDetail(): DashboardFocusState {
  return initialDashboardFocusState()
}

/**
 * Clamp selection indices and scroll offsets after a refresh where table sizes
 * may have changed. Preserves focused table — does not reset context.
 * Ensures the selected row remains visible after clamping.
 */
export function clampAfterRefresh(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
  activeVisibleRowCount: number,
  doneVisibleRowCount: number,
  epicCount?: number,
  epicVisibleRowCount?: number,
): DashboardFocusState {
  const activeSelectedIndex =
    activeCount === 0 ? 0 : Math.min(state.activeSelectedIndex, activeCount - 1)
  const doneSelectedIndex =
    doneCount === 0 ? 0 : Math.min(state.doneSelectedIndex, doneCount - 1)

  const eCount = epicCount ?? 0
  const eVis = epicVisibleRowCount ?? 0
  const epicSelectedIndex =
    eCount === 0 ? 0 : Math.min(state.epicSelectedIndex, eCount - 1)

  // Clamp scroll offsets to valid range, then ensure selected row is visible
  const activeScrollClamped = clampScrollOffset(
    state.activeScrollOffset,
    activeCount,
    activeVisibleRowCount,
  )
  const doneScrollClamped = clampScrollOffset(
    state.doneScrollOffset,
    doneCount,
    doneVisibleRowCount,
  )
  const epicScrollClamped = clampScrollOffset(
    state.epicScrollOffset,
    eCount,
    eVis,
  )

  // If in detail view and the focused table is now empty, the selected task
  // is no longer resolvable — fall back to dashboard view.
  const focusedTableEmpty =
    state.focusedTable === "active" ? activeCount === 0
    : state.focusedTable === "done" ? doneCount === 0
    : eCount === 0
  const viewMode =
    state.viewMode === "detail" && focusedTableEmpty ? "dashboard" : state.viewMode

  return {
    ...state,
    viewMode,
    activeSelectedIndex,
    doneSelectedIndex,
    epicSelectedIndex,
    activeScrollOffset: ensureVisible(activeScrollClamped, activeSelectedIndex, activeVisibleRowCount),
    doneScrollOffset: ensureVisible(doneScrollClamped, doneSelectedIndex, doneVisibleRowCount),
    epicScrollOffset: ensureVisible(epicScrollClamped, epicSelectedIndex, eVis),
  }
}
