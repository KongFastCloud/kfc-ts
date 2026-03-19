/**
 * ABOUTME: Pure dashboard focus and selection state logic.
 * Extracted from WatchApp for testability. Contains the state shape,
 * initial state factory, and all state transition functions for
 * dashboard table focus, per-table selection, and view mode.
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
  /** Current view mode. */
  viewMode: "dashboard" | "detail"
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** Initial dashboard state: top table focused, first row selected. */
export function initialDashboardFocusState(): DashboardFocusState {
  return {
    focusedTable: "active",
    activeSelectedIndex: 0,
    doneSelectedIndex: 0,
    viewMode: "dashboard",
  }
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

/** Move selection up within the focused table. */
export function moveSelectionUp(state: DashboardFocusState): DashboardFocusState {
  if (state.focusedTable === "active") {
    return {
      ...state,
      activeSelectedIndex: Math.max(0, state.activeSelectedIndex - 1),
    }
  }
  return {
    ...state,
    doneSelectedIndex: Math.max(0, state.doneSelectedIndex - 1),
  }
}

/** Move selection down within the focused table. */
export function moveSelectionDown(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
): DashboardFocusState {
  if (state.focusedTable === "active") {
    return {
      ...state,
      activeSelectedIndex:
        activeCount === 0 ? 0 : Math.min(activeCount - 1, state.activeSelectedIndex + 1),
    }
  }
  return {
    ...state,
    doneSelectedIndex:
      doneCount === 0 ? 0 : Math.min(doneCount - 1, state.doneSelectedIndex + 1),
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
 * Clamp selection indices after a refresh where table sizes may have changed.
 * Preserves focused table — does not reset context.
 */
export function clampAfterRefresh(
  state: DashboardFocusState,
  activeCount: number,
  doneCount: number,
): DashboardFocusState {
  return {
    ...state,
    activeSelectedIndex:
      activeCount === 0 ? 0 : Math.min(state.activeSelectedIndex, activeCount - 1),
    doneSelectedIndex:
      doneCount === 0 ? 0 : Math.min(state.doneSelectedIndex, doneCount - 1),
  }
}
