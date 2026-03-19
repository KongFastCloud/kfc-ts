/**
 * ABOUTME: Tests for dashboard focus and selection state logic.
 * Covers the acceptance criteria for the dashboard interaction model:
 * - Only one table active at a time
 * - Tab switches the active table (including when empty)
 * - Enter on empty active table does nothing
 * - Initial state focuses top table, selects first row
 * - Refresh preserves focus and clamps selection
 * - Returning from detail resets to top table, first row
 */

import { describe, it, expect } from "bun:test"
import {
  initialDashboardFocusState,
  toggleFocusedTable,
  moveSelectionUp,
  moveSelectionDown,
  enterDetail,
  returnFromDetail,
  clampAfterRefresh,
  type DashboardFocusState,
} from "../src/tui/dashboardFocus.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateWith(overrides: Partial<DashboardFocusState>): DashboardFocusState {
  return { ...initialDashboardFocusState(), ...overrides }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initialDashboardFocusState", () => {
  it("focuses the top (active) table", () => {
    const s = initialDashboardFocusState()
    expect(s.focusedTable).toBe("active")
  })

  it("selects the first row of both tables", () => {
    const s = initialDashboardFocusState()
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("starts in dashboard view mode", () => {
    const s = initialDashboardFocusState()
    expect(s.viewMode).toBe("dashboard")
  })
})

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("toggleFocusedTable", () => {
  it("switches from active to done", () => {
    const s = toggleFocusedTable(stateWith({ focusedTable: "active" }))
    expect(s.focusedTable).toBe("done")
  })

  it("switches from done to active", () => {
    const s = toggleFocusedTable(stateWith({ focusedTable: "done" }))
    expect(s.focusedTable).toBe("active")
  })

  it("preserves selection indices when switching", () => {
    const s = toggleFocusedTable(
      stateWith({ focusedTable: "active", activeSelectedIndex: 3, doneSelectedIndex: 1 }),
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.doneSelectedIndex).toBe(1)
  })

  it("works when toggling to an empty table (no crash, focus moves)", () => {
    // Empty table scenario: focus should still move
    const s = toggleFocusedTable(stateWith({ focusedTable: "active" }))
    expect(s.focusedTable).toBe("done")
    // Selection index stays 0 — the table may be empty but that's OK
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("does not change view mode", () => {
    const s = toggleFocusedTable(stateWith({ viewMode: "dashboard" }))
    expect(s.viewMode).toBe("dashboard")
  })
})

// ---------------------------------------------------------------------------
// Up/Down navigation
// ---------------------------------------------------------------------------

describe("moveSelectionUp", () => {
  it("decrements active index when active table is focused", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "active", activeSelectedIndex: 2 }))
    expect(s.activeSelectedIndex).toBe(1)
  })

  it("decrements done index when done table is focused", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "done", doneSelectedIndex: 3 }))
    expect(s.doneSelectedIndex).toBe(2)
  })

  it("clamps at zero (does not go negative)", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "active", activeSelectedIndex: 0 }))
    expect(s.activeSelectedIndex).toBe(0)
  })

  it("does not affect the other table's index", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 2, doneSelectedIndex: 5 }),
    )
    expect(s.doneSelectedIndex).toBe(5)
  })
})

describe("moveSelectionDown", () => {
  it("increments active index within bounds", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 1 }),
      5, // activeCount
      3, // doneCount
    )
    expect(s.activeSelectedIndex).toBe(2)
  })

  it("increments done index within bounds", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0 }),
      5,
      3,
    )
    expect(s.doneSelectedIndex).toBe(1)
  })

  it("clamps at last row of active table", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4 }),
      5,
      3,
    )
    expect(s.activeSelectedIndex).toBe(4) // 5-1
  })

  it("clamps at last row of done table", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 2 }),
      5,
      3,
    )
    expect(s.doneSelectedIndex).toBe(2) // 3-1
  })

  it("stays at 0 when active table is empty", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 0 }),
      0, // empty
      3,
    )
    expect(s.activeSelectedIndex).toBe(0)
  })

  it("stays at 0 when done table is empty", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0 }),
      5,
      0, // empty
    )
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("does not affect the other table's index", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", activeSelectedIndex: 3, doneSelectedIndex: 1 }),
      5,
      4,
    )
    expect(s.activeSelectedIndex).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Enter detail
// ---------------------------------------------------------------------------

describe("enterDetail", () => {
  it("switches to detail mode when focused table has items", () => {
    const s = enterDetail(stateWith({ focusedTable: "active" }), 5, 3)
    expect(s.viewMode).toBe("detail")
  })

  it("does nothing when the focused active table is empty", () => {
    const before = stateWith({ focusedTable: "active" })
    const after = enterDetail(before, 0, 3)
    expect(after).toEqual(before)
  })

  it("does nothing when the focused done table is empty", () => {
    const before = stateWith({ focusedTable: "done" })
    const after = enterDetail(before, 5, 0)
    expect(after).toEqual(before)
  })

  it("enters detail when focused done table has items", () => {
    const s = enterDetail(stateWith({ focusedTable: "done" }), 0, 2)
    expect(s.viewMode).toBe("detail")
  })

  it("preserves focus and selection indices", () => {
    const s = enterDetail(
      stateWith({ focusedTable: "done", activeSelectedIndex: 2, doneSelectedIndex: 1 }),
      5,
      3,
    )
    expect(s.focusedTable).toBe("done")
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Return from detail
// ---------------------------------------------------------------------------

describe("returnFromDetail", () => {
  it("resets to initial state (top table, first row, dashboard mode)", () => {
    const s = returnFromDetail()
    expect(s).toEqual(initialDashboardFocusState())
  })

  it("is the same as initial state", () => {
    expect(returnFromDetail()).toEqual({
      focusedTable: "active",
      activeSelectedIndex: 0,
      doneSelectedIndex: 0,
      viewMode: "dashboard",
    })
  })
})

// ---------------------------------------------------------------------------
// Refresh clamping
// ---------------------------------------------------------------------------

describe("clampAfterRefresh", () => {
  it("preserves selection when tables did not shrink", () => {
    const s = clampAfterRefresh(
      stateWith({ focusedTable: "done", activeSelectedIndex: 2, doneSelectedIndex: 3 }),
      5,
      5,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(3)
  })

  it("clamps active index when active table shrank", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 4 }),
      3, // shrank from 5+ to 3
      5,
    )
    expect(s.activeSelectedIndex).toBe(2) // 3-1
  })

  it("clamps done index when done table shrank", () => {
    const s = clampAfterRefresh(
      stateWith({ doneSelectedIndex: 4 }),
      5,
      2, // shrank from 5+ to 2
    )
    expect(s.doneSelectedIndex).toBe(1) // 2-1
  })

  it("clamps both indices independently", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 10, doneSelectedIndex: 10 }),
      3,
      2,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(1)
  })

  it("resets to 0 when a table becomes empty", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 5, doneSelectedIndex: 3 }),
      0,
      0,
    )
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("preserves focused table (does not reset context)", () => {
    const s = clampAfterRefresh(
      stateWith({ focusedTable: "done", activeSelectedIndex: 2, doneSelectedIndex: 4 }),
      5,
      3,
    )
    expect(s.focusedTable).toBe("done")
  })

  it("preserves view mode", () => {
    const s = clampAfterRefresh(
      stateWith({ viewMode: "detail", activeSelectedIndex: 2 }),
      5,
      5,
    )
    expect(s.viewMode).toBe("detail")
  })
})

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe("end-to-end focus scenarios", () => {
  it("initial load → navigate → tab → navigate → enter → escape cycle", () => {
    // Start fresh
    let s = initialDashboardFocusState()
    expect(s.focusedTable).toBe("active")
    expect(s.activeSelectedIndex).toBe(0)

    // Move down twice in active table (5 active, 3 done)
    s = moveSelectionDown(s, 5, 3)
    s = moveSelectionDown(s, 5, 3)
    expect(s.activeSelectedIndex).toBe(2)

    // Tab to done table
    s = toggleFocusedTable(s)
    expect(s.focusedTable).toBe("done")
    expect(s.doneSelectedIndex).toBe(0) // independent index

    // Move down once in done table
    s = moveSelectionDown(s, 5, 3)
    expect(s.doneSelectedIndex).toBe(1)

    // Enter detail
    s = enterDetail(s, 5, 3)
    expect(s.viewMode).toBe("detail")
    expect(s.focusedTable).toBe("done")
    expect(s.doneSelectedIndex).toBe(1)

    // Return from detail — resets to top table, row 0
    s = returnFromDetail()
    expect(s.focusedTable).toBe("active")
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.viewMode).toBe("dashboard")
  })

  it("refresh preserves focus on done table while clamping", () => {
    let s = stateWith({
      focusedTable: "done",
      activeSelectedIndex: 3,
      doneSelectedIndex: 4,
    })

    // Refresh: active table has 5, done table shrinks to 2
    s = clampAfterRefresh(s, 5, 2)
    expect(s.focusedTable).toBe("done") // preserved
    expect(s.activeSelectedIndex).toBe(3) // within bounds
    expect(s.doneSelectedIndex).toBe(1) // clamped from 4 to 1
  })

  it("tab to empty table, press enter, nothing happens", () => {
    let s = stateWith({ focusedTable: "active" })
    // Tab to done (which is empty)
    s = toggleFocusedTable(s)
    expect(s.focusedTable).toBe("done")

    // Enter on empty done table
    const before = { ...s }
    s = enterDetail(s, 5, 0)
    expect(s).toEqual(before)
    expect(s.viewMode).toBe("dashboard")
  })
})
