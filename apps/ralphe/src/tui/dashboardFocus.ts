/**
 * ABOUTME: Pure dashboard focus, selection, and viewport state logic.
 * Extracted from WatchApp for testability. Contains the state shape,
 * initial state factory, and all state transition functions for
 * dashboard table focus, per-table selection, per-table scroll offset,
 * and view mode.
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
// State transitions
// ---------------------------------------------------------------------------

/** Toggle focused table (Tab key). Works even when a table is empty. */
export function toggleFocusedTable(state: DashboardFocusState): DashboardFocusState {
  return {
    ...state,
    focusedTable: state.focusedTable === "active" ? "done" : "active",
  }
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
  const newIndex = Math.max(0, state.doneSelectedIndex - 1)
  return {
    ...state,
    doneSelectedIndex: newIndex,
    doneScrollOffset: ensureVisible(state.doneScrollOffset, newIndex, visibleRowCount),
  }
}

/** Move selection down within the focused table. Adjusts scroll offset if needed. */
export function moveSelectionDown(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
  visibleRowCount: number,
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
  const newIndex =
    doneCount === 0 ? 0 : Math.min(doneCount - 1, state.doneSelectedIndex + 1)
  return {
    ...state,
    doneSelectedIndex: newIndex,
    doneScrollOffset: ensureVisible(state.doneScrollOffset, newIndex, visibleRowCount),
  }
}

/**
 * Attempt to enter detail view (Enter key).
 * Returns unchanged state if the focused table is empty.
 */
export function enterDetail(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
): DashboardFocusState {
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
): DashboardFocusState {
  const activeSelectedIndex =
    activeCount === 0 ? 0 : Math.min(state.activeSelectedIndex, activeCount - 1)
  const doneSelectedIndex =
    doneCount === 0 ? 0 : Math.min(state.doneSelectedIndex, doneCount - 1)

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

  // If in detail view and the focused table is now empty, the selected task
  // is no longer resolvable — fall back to dashboard view.
  const focusedTableEmpty =
    state.focusedTable === "active" ? activeCount === 0 : doneCount === 0
  const viewMode =
    state.viewMode === "detail" && focusedTableEmpty ? "dashboard" : state.viewMode

  return {
    ...state,
    viewMode,
    activeSelectedIndex,
    doneSelectedIndex,
    activeScrollOffset: ensureVisible(activeScrollClamped, activeSelectedIndex, activeVisibleRowCount),
    doneScrollOffset: ensureVisible(doneScrollClamped, doneSelectedIndex, doneVisibleRowCount),
  }
}
