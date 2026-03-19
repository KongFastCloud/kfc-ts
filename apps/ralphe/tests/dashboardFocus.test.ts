/**
 * ABOUTME: Tests for dashboard focus, selection, and viewport state logic.
 * Covers the acceptance criteria for the dashboard interaction model:
 * - Only one table active at a time
 * - Tab switches the active table (including when empty)
 * - Enter on empty active table does nothing
 * - Initial state focuses top table, selects first row
 * - Refresh preserves focus and clamps selection and scroll offsets
 * - Returning from detail resets to top table, first row
 * - Per-table scroll offset tracks row visibility independently
 * - Selected row stays visible after navigation and refresh
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
  ensureVisible,
  clampScrollOffset,
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

  it("starts with scroll offsets at zero", () => {
    const s = initialDashboardFocusState()
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("starts in dashboard view mode", () => {
    const s = initialDashboardFocusState()
    expect(s.viewMode).toBe("dashboard")
  })
})

// ---------------------------------------------------------------------------
// Viewport helpers
// ---------------------------------------------------------------------------

describe("ensureVisible", () => {
  it("returns offset unchanged when selection is within viewport", () => {
    expect(ensureVisible(2, 4, 5)).toBe(2) // viewport [2..6], selection 4
  })

  it("scrolls up when selection is above viewport", () => {
    expect(ensureVisible(5, 2, 5)).toBe(2)
  })

  it("scrolls down when selection is below viewport", () => {
    // viewport [0..4], selection 7 → need offset 3 so viewport [3..7]
    expect(ensureVisible(0, 7, 5)).toBe(3)
  })

  it("does not center the selection", () => {
    // Selection at bottom edge — should not center
    expect(ensureVisible(0, 4, 5)).toBe(0) // row 4 is last visible in [0..4]
  })

  it("returns 0 for degenerate viewport (visibleRowCount <= 0)", () => {
    expect(ensureVisible(5, 3, 0)).toBe(0)
    expect(ensureVisible(5, 3, -1)).toBe(0)
  })

  it("handles selection at exact viewport top boundary", () => {
    expect(ensureVisible(3, 3, 5)).toBe(3) // selection == scrollOffset → visible
  })

  it("handles selection at exact viewport bottom boundary", () => {
    expect(ensureVisible(3, 7, 5)).toBe(3) // row 7 = offset 3 + 5 - 1 → visible
  })

  it("handles selection one past bottom boundary", () => {
    expect(ensureVisible(3, 8, 5)).toBe(4) // row 8 just below → scroll down 1
  })

  it("handles visibleRowCount of 1", () => {
    expect(ensureVisible(5, 5, 1)).toBe(5) // visible
    expect(ensureVisible(5, 3, 1)).toBe(3) // above
    expect(ensureVisible(5, 7, 1)).toBe(7) // below
  })
})

describe("clampScrollOffset", () => {
  it("returns 0 when table fits in viewport", () => {
    expect(clampScrollOffset(3, 5, 10)).toBe(0) // 5 rows, 10 visible
  })

  it("returns 0 when table exactly fills viewport", () => {
    expect(clampScrollOffset(0, 5, 5)).toBe(0)
  })

  it("clamps to max valid offset", () => {
    // 20 rows, 5 visible → max offset = 15
    expect(clampScrollOffset(18, 20, 5)).toBe(15)
  })

  it("preserves offset when already valid", () => {
    expect(clampScrollOffset(10, 20, 5)).toBe(10)
  })

  it("returns 0 for zero-row table", () => {
    expect(clampScrollOffset(5, 0, 5)).toBe(0)
  })

  it("returns 0 for degenerate visible count", () => {
    expect(clampScrollOffset(5, 20, 0)).toBe(0)
    expect(clampScrollOffset(5, 20, -1)).toBe(0)
  })

  it("clamps negative offset to 0", () => {
    expect(clampScrollOffset(-3, 20, 5)).toBe(0)
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

  it("preserves scroll offsets when switching", () => {
    const s = toggleFocusedTable(
      stateWith({ focusedTable: "active", activeScrollOffset: 5, doneScrollOffset: 2 }),
    )
    expect(s.activeScrollOffset).toBe(5)
    expect(s.doneScrollOffset).toBe(2)
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
  const VIS = 5 // visible row count for tests

  it("decrements active index when active table is focused", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "active", activeSelectedIndex: 2 }), VIS)
    expect(s.activeSelectedIndex).toBe(1)
  })

  it("decrements done index when done table is focused", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "done", doneSelectedIndex: 3 }), VIS)
    expect(s.doneSelectedIndex).toBe(2)
  })

  it("clamps at zero (does not go negative)", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "active", activeSelectedIndex: 0 }), VIS)
    expect(s.activeSelectedIndex).toBe(0)
  })

  it("does not affect the other table's index", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 2, doneSelectedIndex: 5 }),
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(5)
  })

  it("does not affect the other table's scroll offset", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 2, doneScrollOffset: 3 }),
      VIS,
    )
    expect(s.doneScrollOffset).toBe(3)
  })

  it("scrolls viewport up when selection moves above viewport", () => {
    // viewport at [5..9], selection at 5, move up → selection 4, viewport should adjust
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 5, activeScrollOffset: 5 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(4)
    expect(s.activeScrollOffset).toBe(4) // scrolled up to reveal row 4
  })

  it("does not scroll when selection stays within viewport", () => {
    // viewport at [0..4], selection at 3, move up → selection 2, still visible
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 3, activeScrollOffset: 0 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(0)
  })
})

describe("moveSelectionDown", () => {
  const VIS = 5

  it("increments active index within bounds", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 1 }),
      10, // activeCount
      3, // doneCount
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
  })

  it("increments done index within bounds", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0 }),
      5,
      3,
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(1)
  })

  it("clamps at last row of active table", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4 }),
      5,
      3,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(4) // 5-1
  })

  it("clamps at last row of done table", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 2 }),
      5,
      3,
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(2) // 3-1
  })

  it("stays at 0 when active table is empty", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 0 }),
      0, // empty
      3,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(0)
  })

  it("stays at 0 when done table is empty", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0 }),
      5,
      0, // empty
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("does not affect the other table's index", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", activeSelectedIndex: 3, doneSelectedIndex: 1 }),
      5,
      4,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(3)
  })

  it("does not affect the other table's scroll offset", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", activeScrollOffset: 7, doneSelectedIndex: 1 }),
      5,
      10,
      VIS,
    )
    expect(s.activeScrollOffset).toBe(7)
  })

  it("scrolls viewport down when selection moves below viewport", () => {
    // viewport [0..4], selection at 4, move down → selection 5, viewport adjusts
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4, activeScrollOffset: 0 }),
      20,
      3,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(5)
    expect(s.activeScrollOffset).toBe(1) // just enough to reveal row 5
  })

  it("does not scroll when selection stays within viewport", () => {
    // viewport [0..4], selection at 2, move down → selection 3, still visible
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 2, activeScrollOffset: 0 }),
      20,
      3,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.activeScrollOffset).toBe(0)
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

  it("preserves focus, selection indices, and scroll offsets", () => {
    const s = enterDetail(
      stateWith({
        focusedTable: "done",
        activeSelectedIndex: 2,
        doneSelectedIndex: 1,
        activeScrollOffset: 3,
        doneScrollOffset: 0,
      }),
      5,
      3,
    )
    expect(s.focusedTable).toBe("done")
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(1)
    expect(s.activeScrollOffset).toBe(3)
    expect(s.doneScrollOffset).toBe(0)
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
      activeScrollOffset: 0,
      doneScrollOffset: 0,
      viewMode: "dashboard",
    })
  })
})

// ---------------------------------------------------------------------------
// Refresh clamping
// ---------------------------------------------------------------------------

describe("clampAfterRefresh", () => {
  const VIS = 5

  it("preserves selection when tables did not shrink", () => {
    const s = clampAfterRefresh(
      stateWith({ focusedTable: "done", activeSelectedIndex: 2, doneSelectedIndex: 3 }),
      5,
      5,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(3)
  })

  it("clamps active index when active table shrank", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 4 }),
      3, // shrank from 5+ to 3
      5,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2) // 3-1
  })

  it("clamps done index when done table shrank", () => {
    const s = clampAfterRefresh(
      stateWith({ doneSelectedIndex: 4 }),
      5,
      2, // shrank from 5+ to 2
      VIS,
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(1) // 2-1
  })

  it("clamps both indices independently", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 10, doneSelectedIndex: 10 }),
      3,
      2,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(1)
  })

  it("resets to 0 when a table becomes empty", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 5, doneSelectedIndex: 3 }),
      0,
      0,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
  })

  it("preserves focused table (does not reset context)", () => {
    const s = clampAfterRefresh(
      stateWith({ focusedTable: "done", activeSelectedIndex: 2, doneSelectedIndex: 4 }),
      5,
      3,
      VIS,
      VIS,
    )
    expect(s.focusedTable).toBe("done")
  })

  it("preserves view mode", () => {
    const s = clampAfterRefresh(
      stateWith({ viewMode: "detail", activeSelectedIndex: 2 }),
      5,
      5,
      VIS,
      VIS,
    )
    expect(s.viewMode).toBe("detail")
  })

  it("clamps scroll offset when table shrinks below viewport", () => {
    // Had 20 rows with offset 15, table shrinks to 3 (fits in viewport of 5)
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 2, activeScrollOffset: 15 }),
      3,
      5,
      VIS,
      VIS,
    )
    expect(s.activeScrollOffset).toBe(0) // table fits, offset must be 0
  })

  it("clamps scroll offset to max valid value when table shrinks", () => {
    // Had 20 rows with offset 15, table shrinks to 8 → max offset = 3
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 2, activeScrollOffset: 15 }),
      8,
      5,
      VIS,
      VIS,
    )
    // clampScrollOffset(15, 8, 5) → 3, ensureVisible(3, 2, 5) → 2 (scroll up to reveal)
    expect(s.activeScrollOffset).toBe(2)
    expect(s.activeSelectedIndex).toBe(2)
  })

  it("ensures selected row remains visible after clamping", () => {
    // Selection at 7, offset at 10, table shrinks to 8 → selection clamps to 7
    // max offset = 3, offset clamps to 3, viewport [3..7] → row 7 visible
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 7, activeScrollOffset: 10 }),
      8,
      5,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3) // viewport [3..7], row 7 visible
  })

  it("resets scroll offset to 0 when table becomes empty", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 5,
        activeScrollOffset: 10,
        doneSelectedIndex: 3,
        doneScrollOffset: 7,
      }),
      0,
      0,
      VIS,
      VIS,
    )
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("handles independent visible row counts per table", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 9,
        activeScrollOffset: 5,
        doneSelectedIndex: 4,
        doneScrollOffset: 2,
      }),
      10, // active rows
      5, // done rows
      3, // active visible
      10, // done visible
    )
    // active: selection 9, offset clamped to max 7, ensureVisible(7, 9, 3) → 7
    expect(s.activeSelectedIndex).toBe(9)
    expect(s.activeScrollOffset).toBe(7)
    // done: 5 rows fits in 10 visible → offset 0
    expect(s.doneSelectedIndex).toBe(4)
    expect(s.doneScrollOffset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Viewport independence (per-table scroll offset)
// ---------------------------------------------------------------------------

describe("per-table viewport independence", () => {
  const VIS = 5

  it("active table navigation does not affect done table scroll offset", () => {
    let s = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 4,
      activeScrollOffset: 0,
      doneScrollOffset: 7,
    })
    // Move down past viewport
    s = moveSelectionDown(s, 20, 20, VIS)
    expect(s.activeScrollOffset).toBe(1) // scrolled
    expect(s.doneScrollOffset).toBe(7) // unchanged
  })

  it("done table navigation does not affect active table scroll offset", () => {
    let s = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 4,
      doneScrollOffset: 0,
      activeScrollOffset: 3,
    })
    s = moveSelectionDown(s, 20, 20, VIS)
    expect(s.doneScrollOffset).toBe(1)
    expect(s.activeScrollOffset).toBe(3) // unchanged
  })

  it("tab switching preserves both tables' scroll offsets", () => {
    const s = toggleFocusedTable(
      stateWith({ focusedTable: "active", activeScrollOffset: 5, doneScrollOffset: 10 }),
    )
    expect(s.activeScrollOffset).toBe(5)
    expect(s.doneScrollOffset).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe("end-to-end focus scenarios", () => {
  const VIS = 5

  it("initial load → navigate → tab → navigate → enter → escape cycle", () => {
    // Start fresh
    let s = initialDashboardFocusState()
    expect(s.focusedTable).toBe("active")
    expect(s.activeSelectedIndex).toBe(0)

    // Move down twice in active table (5 active, 3 done)
    s = moveSelectionDown(s, 5, 3, VIS)
    s = moveSelectionDown(s, 5, 3, VIS)
    expect(s.activeSelectedIndex).toBe(2)

    // Tab to done table
    s = toggleFocusedTable(s)
    expect(s.focusedTable).toBe("done")
    expect(s.doneSelectedIndex).toBe(0) // independent index

    // Move down once in done table
    s = moveSelectionDown(s, 5, 3, VIS)
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
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
    expect(s.viewMode).toBe("dashboard")
  })

  it("refresh preserves focus on done table while clamping", () => {
    let s = stateWith({
      focusedTable: "done",
      activeSelectedIndex: 3,
      doneSelectedIndex: 4,
    })

    // Refresh: active table has 5, done table shrinks to 2
    s = clampAfterRefresh(s, 5, 2, VIS, VIS)
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

  it("navigating a long table scrolls viewport correctly", () => {
    let s = initialDashboardFocusState()
    const ROWS = 20

    // Move down past viewport (5 visible rows)
    for (let i = 0; i < 7; i++) {
      s = moveSelectionDown(s, ROWS, 5, VIS)
    }

    expect(s.activeSelectedIndex).toBe(7)
    // Viewport should have scrolled to keep row 7 visible: offset = 7 - 5 + 1 = 3
    expect(s.activeScrollOffset).toBe(3)

    // Move back up through viewport
    for (let i = 0; i < 4; i++) {
      s = moveSelectionUp(s, VIS)
    }

    expect(s.activeSelectedIndex).toBe(3)
    // Row 3 is at top of viewport [3..7], so offset stays 3
    expect(s.activeScrollOffset).toBe(3)

    // Move up one more — now selection goes above viewport
    s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(2) // scrolled up to reveal row 2
  })

  it("refresh after scrolling preserves visible context", () => {
    // Scrolled state: viewing rows [5..9], selected row 7
    let s = stateWith({
      focusedTable: "active",
      activeSelectedIndex: 7,
      activeScrollOffset: 5,
    })

    // Refresh with same count — nothing changes
    s = clampAfterRefresh(s, 20, 10, VIS, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(5)

    // Refresh with shrink to 8 rows — selection still valid, offset clamps
    s = clampAfterRefresh(s, 8, 10, VIS, VIS)
    expect(s.activeSelectedIndex).toBe(7) // still valid (8-1)
    expect(s.activeScrollOffset).toBe(3) // max offset = 8-5 = 3, then ensureVisible(3,7,5) = 3
  })

  it("short tables keep scroll offset at zero", () => {
    let s = initialDashboardFocusState()

    // Active table has only 3 rows (fits in viewport of 5)
    s = moveSelectionDown(s, 3, 3, VIS)
    expect(s.activeSelectedIndex).toBe(1)
    expect(s.activeScrollOffset).toBe(0)

    s = moveSelectionDown(s, 3, 3, VIS)
    expect(s.activeSelectedIndex).toBe(2) // last row
    expect(s.activeScrollOffset).toBe(0) // still fits

    // Clamp also keeps offset at 0
    s = clampAfterRefresh(s, 3, 3, VIS, VIS)
    expect(s.activeScrollOffset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Viewport regression coverage
// ---------------------------------------------------------------------------

describe("viewport regression: per-table state transitions", () => {
  const VIS = 5

  it("done table scrolls down when selection moves below viewport", () => {
    let s = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 4,
      doneScrollOffset: 0,
    })
    s = moveSelectionDown(s, 10, 20, VIS)
    expect(s.doneSelectedIndex).toBe(5)
    expect(s.doneScrollOffset).toBe(1) // just enough to reveal row 5
  })

  it("done table scrolls up when selection moves above viewport", () => {
    let s = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 5,
      doneScrollOffset: 5,
    })
    s = moveSelectionUp(s, VIS)
    expect(s.doneSelectedIndex).toBe(4)
    expect(s.doneScrollOffset).toBe(4) // scrolled up to reveal row 4
  })

  it("done table does not scroll when selection stays within viewport", () => {
    let s = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 2,
      doneScrollOffset: 0,
    })
    s = moveSelectionDown(s, 5, 20, VIS)
    expect(s.doneSelectedIndex).toBe(3)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("navigating a long done table scrolls viewport correctly", () => {
    let s = stateWith({ focusedTable: "done" })
    const ROWS = 20

    // Move down past viewport
    for (let i = 0; i < 7; i++) {
      s = moveSelectionDown(s, 5, ROWS, VIS)
    }
    expect(s.doneSelectedIndex).toBe(7)
    expect(s.doneScrollOffset).toBe(3) // 7 - 5 + 1

    // Move back up through viewport
    for (let i = 0; i < 4; i++) {
      s = moveSelectionUp(s, VIS)
    }
    expect(s.doneSelectedIndex).toBe(3)
    expect(s.doneScrollOffset).toBe(3) // row 3 is at top of viewport

    // Move one more up — selection goes above viewport
    s = moveSelectionUp(s, VIS)
    expect(s.doneSelectedIndex).toBe(2)
    expect(s.doneScrollOffset).toBe(2) // scrolled up to reveal row 2
  })

  it("active and done tables maintain independent viewport state through navigation", () => {
    let s = initialDashboardFocusState()

    // Scroll active table down
    for (let i = 0; i < 8; i++) {
      s = moveSelectionDown(s, 20, 20, VIS)
    }
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4) // 8 - 5 + 1
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.doneScrollOffset).toBe(0)

    // Tab to done, scroll it independently
    s = toggleFocusedTable(s)
    for (let i = 0; i < 6; i++) {
      s = moveSelectionDown(s, 20, 20, VIS)
    }
    expect(s.doneSelectedIndex).toBe(6)
    expect(s.doneScrollOffset).toBe(2) // 6 - 5 + 1

    // Active table state is unchanged
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4)

    // Tab back to active, navigate up — done table still unchanged
    s = toggleFocusedTable(s)
    s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(4) // row 7 still visible in [4..8]
    expect(s.doneSelectedIndex).toBe(6)
    expect(s.doneScrollOffset).toBe(2)
  })
})

describe("viewport regression: selection-to-viewport synchronization", () => {
  const VIS = 5

  it("selection at exact bottom boundary does not scroll", () => {
    // viewport [3..7], selection at 7 → no scroll needed
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 6, activeScrollOffset: 3 }),
      20,
      5,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3) // row 7 = offset 3 + 5 - 1
  })

  it("selection one past bottom boundary triggers minimal scroll", () => {
    // viewport [3..7], selection at 7, move down → 8, needs scroll
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 7, activeScrollOffset: 3 }),
      20,
      5,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4) // scrolled by exactly 1
  })

  it("selection at exact top boundary does not scroll", () => {
    // viewport [3..7], selection at 3 → no scroll
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4, activeScrollOffset: 3 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.activeScrollOffset).toBe(3)
  })

  it("selection one past top boundary triggers minimal scroll", () => {
    // viewport [3..7], selection at 3, move up → 2, needs scroll
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 3, activeScrollOffset: 3 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(2) // scrolled by exactly 1
  })

  it("viewport never centers the selection after boundary crossing", () => {
    // After crossing bottom boundary, selection should be at the bottom of viewport, not centered
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4, activeScrollOffset: 0 }),
      20,
      5,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(5)
    expect(s.activeScrollOffset).toBe(1) // selection at bottom, not centered at offset 3
  })

  it("rapid sequential down movements produce consistent minimal scrolling", () => {
    let s = stateWith({ focusedTable: "active", activeScrollOffset: 0 })

    // Move from row 0 through row 9
    for (let i = 0; i < 10; i++) {
      s = moveSelectionDown(s, 20, 5, VIS)
    }

    expect(s.activeSelectedIndex).toBe(10)
    // offset should be 10 - 5 + 1 = 6 (selection at bottom of viewport)
    expect(s.activeScrollOffset).toBe(6)

    // Verify the viewport window: rows [6..10] are visible
    expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
    expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
  })
})

describe("viewport regression: refresh clamping", () => {
  const VIS = 5

  it("refresh clamps done table scroll offset when done table shrinks", () => {
    // Done table scrolled to offset 15, shrinks to 3 rows (fits in viewport)
    const s = clampAfterRefresh(
      stateWith({
        focusedTable: "done",
        doneSelectedIndex: 2,
        doneScrollOffset: 15,
      }),
      5,
      3,
      VIS,
      VIS,
    )
    expect(s.doneScrollOffset).toBe(0) // table fits, offset must be 0
    expect(s.doneSelectedIndex).toBe(2) // still valid
  })

  it("refresh clamps done table selection and ensures visibility", () => {
    const s = clampAfterRefresh(
      stateWith({
        focusedTable: "done",
        doneSelectedIndex: 12,
        doneScrollOffset: 10,
      }),
      10,
      8, // done table shrinks
      VIS,
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(7) // clamped to 8-1
    expect(s.doneScrollOffset).toBe(3) // max offset = 8-5 = 3, ensureVisible(3,7,5) = 3
  })

  it("refresh preserves both tables' independent scroll positions when sizes unchanged", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 7,
        activeScrollOffset: 5,
        doneSelectedIndex: 3,
        doneScrollOffset: 2,
      }),
      20,
      10,
      VIS,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(5)
    expect(s.doneSelectedIndex).toBe(3)
    expect(s.doneScrollOffset).toBe(2)
  })

  it("refresh clamps both tables independently when both shrink", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 15,
        activeScrollOffset: 12,
        doneSelectedIndex: 10,
        doneScrollOffset: 8,
      }),
      6, // active shrinks
      4, // done shrinks
      VIS,
      VIS,
    )
    // active: selection clamped to 5, offset clamped to max(0, 6-5)=1, ensureVisible(1,5,5)=1
    expect(s.activeSelectedIndex).toBe(5)
    expect(s.activeScrollOffset).toBe(1)
    // done: selection clamped to 3, 4 rows <= 5 visible → offset 0
    expect(s.doneSelectedIndex).toBe(3)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("refresh after scrolling done table preserves visible context", () => {
    let s = stateWith({
      focusedTable: "done",
      doneSelectedIndex: 7,
      doneScrollOffset: 5,
    })

    // Refresh with same count — nothing changes
    s = clampAfterRefresh(s, 10, 20, VIS, VIS)
    expect(s.doneSelectedIndex).toBe(7)
    expect(s.doneScrollOffset).toBe(5)

    // Refresh with done table shrink to 8 rows
    s = clampAfterRefresh(s, 10, 8, VIS, VIS)
    expect(s.doneSelectedIndex).toBe(7) // still valid (8-1)
    expect(s.doneScrollOffset).toBe(3) // max offset = 8-5 = 3
  })
})

describe("viewport regression: empty and short tables", () => {
  const VIS = 5

  it("moveSelectionUp on empty active table keeps index and offset at 0", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 0, activeScrollOffset: 0 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
  })

  it("moveSelectionUp on empty done table keeps index and offset at 0", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0, doneScrollOffset: 0 }),
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("moveSelectionDown on empty active table keeps index and offset at 0", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 0, activeScrollOffset: 0 }),
      0,
      5,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
  })

  it("moveSelectionDown on empty done table keeps index and offset at 0", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "done", doneSelectedIndex: 0, doneScrollOffset: 0 }),
      5,
      0,
      VIS,
    )
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("short done table keeps scroll offset at zero throughout navigation", () => {
    let s = stateWith({ focusedTable: "done" })

    // Done table has only 3 rows (fits in viewport of 5)
    s = moveSelectionDown(s, 10, 3, VIS)
    expect(s.doneSelectedIndex).toBe(1)
    expect(s.doneScrollOffset).toBe(0)

    s = moveSelectionDown(s, 10, 3, VIS)
    expect(s.doneSelectedIndex).toBe(2) // last row
    expect(s.doneScrollOffset).toBe(0)

    // Move up — still no scroll
    s = moveSelectionUp(s, VIS)
    expect(s.doneSelectedIndex).toBe(1)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("refresh preserves zero offset when tables remain short", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 2,
        activeScrollOffset: 0,
        doneSelectedIndex: 1,
        doneScrollOffset: 0,
      }),
      3,
      2,
      VIS,
      VIS,
    )
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("table growing from empty to populated keeps selection at 0", () => {
    // Start with empty tables, selection at 0
    let s = stateWith({
      activeSelectedIndex: 0,
      activeScrollOffset: 0,
      doneSelectedIndex: 0,
      doneScrollOffset: 0,
    })

    // Refresh: tables now have data
    s = clampAfterRefresh(s, 10, 5, VIS, VIS)
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("single-row table keeps scroll offset at zero", () => {
    let s = stateWith({ focusedTable: "active" })

    // Can't move down past the single row
    s = moveSelectionDown(s, 1, 5, VIS)
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)

    // Can't move up from first row
    s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
  })
})

describe("viewport regression: visible-slice contract", () => {
  const VIS = 5

  it("visible slice contains exactly the expected rows after scrolling", () => {
    let s = initialDashboardFocusState()
    const allRows = Array.from({ length: 20 }, (_, i) => `row-${i}`)

    // Move down to row 7
    for (let i = 0; i < 7; i++) {
      s = moveSelectionDown(s, allRows.length, 5, VIS)
    }

    const visibleSlice = allRows.slice(s.activeScrollOffset, s.activeScrollOffset + VIS)
    expect(visibleSlice).toEqual(["row-3", "row-4", "row-5", "row-6", "row-7"])
    expect(visibleSlice).toContain(`row-${s.activeSelectedIndex}`)
  })

  it("visible slice of a short table equals the full table", () => {
    const s = initialDashboardFocusState()
    const allRows = ["row-0", "row-1", "row-2"]

    const visibleSlice = allRows.slice(s.activeScrollOffset, s.activeScrollOffset + VIS)
    expect(visibleSlice).toEqual(allRows)
  })

  it("visible slice is empty for an empty table", () => {
    const s = initialDashboardFocusState()
    const allRows: string[] = []

    const visibleSlice = allRows.slice(s.activeScrollOffset, s.activeScrollOffset + VIS)
    expect(visibleSlice).toEqual([])
  })

  it("selected row is always within the visible slice after any navigation", () => {
    let s = initialDashboardFocusState()
    const ROWS = 30

    // Navigate down through the entire table
    for (let i = 0; i < ROWS - 1; i++) {
      s = moveSelectionDown(s, ROWS, 10, VIS)
      expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
      expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
    }

    // Navigate back up through the entire table
    for (let i = 0; i < ROWS - 1; i++) {
      s = moveSelectionUp(s, VIS)
      expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
      expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
    }
  })

  it("selected row is within visible slice after refresh clamping", () => {
    // Scrolled deep into a large table
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 18,
        activeScrollOffset: 15,
        doneSelectedIndex: 12,
        doneScrollOffset: 10,
      }),
      10, // active shrinks from 20+ to 10
      8,  // done shrinks from 15+ to 8
      VIS,
      VIS,
    )

    // Active: selection clamped to 9, must be visible
    expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
    expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)

    // Done: selection clamped to 7, must be visible
    expect(s.doneSelectedIndex).toBeGreaterThanOrEqual(s.doneScrollOffset)
    expect(s.doneSelectedIndex).toBeLessThan(s.doneScrollOffset + VIS)
  })
})
