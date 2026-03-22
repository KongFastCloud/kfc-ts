/**
 * ABOUTME: Tests for dashboard focus, selection, and viewport state logic.
 * Covers the invariants for the dashboard interaction model:
 * - Only one table active at a time; Tab toggles it
 * - Initial state: top table focused, first row, scroll at top, dashboard mode
 * - Navigation clamps at boundaries and scrolls minimally (never centers)
 * - Per-table selection and scroll offset are independent
 * - Enter on an empty table is a no-op; on a populated table switches to detail
 * - Return from detail resets to initial state
 * - Refresh clamps selection and scroll, preserves focused table, ensures visibility
 * - Selected row is always within the visible viewport slice
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

/** Field accessors keyed by table name, so table-driven tests stay readable. */
const sel = (s: DashboardFocusState, t: "active" | "done") =>
  t === "active" ? s.activeSelectedIndex : s.doneSelectedIndex
const scroll = (s: DashboardFocusState, t: "active" | "done") =>
  t === "active" ? s.activeScrollOffset : s.doneScrollOffset

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initialDashboardFocusState", () => {
  it("returns focus on active table, both indices at 0, both offsets at 0, dashboard mode", () => {
    const s = initialDashboardFocusState()
    expect(s).toEqual({
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
// Viewport helpers (pure functions — no table duality to collapse)
// ---------------------------------------------------------------------------

describe("ensureVisible", () => {
  it.each([
    // [label, scrollOffset, selectedIndex, visibleRowCount, expected]
    ["within viewport", 2, 4, 5, 2],
    ["above viewport → snaps", 5, 2, 5, 2],
    ["below viewport → minimal scroll", 0, 7, 5, 3],
    ["at exact top boundary", 3, 3, 5, 3],
    ["at exact bottom boundary", 3, 7, 5, 3],
    ["one past bottom boundary", 3, 8, 5, 4],
    ["does not center", 0, 4, 5, 0],
  ] as const)("%s", (_label, offset, idx, vis, expected) => {
    expect(ensureVisible(offset, idx, vis)).toBe(expected)
  })

  it("returns 0 for degenerate viewport (visibleRowCount <= 0)", () => {
    expect(ensureVisible(5, 3, 0)).toBe(0)
    expect(ensureVisible(5, 3, -1)).toBe(0)
  })

  it("handles visibleRowCount of 1", () => {
    expect(ensureVisible(5, 5, 1)).toBe(5) // visible
    expect(ensureVisible(5, 3, 1)).toBe(3) // above
    expect(ensureVisible(5, 7, 1)).toBe(7) // below
  })
})

describe("clampScrollOffset", () => {
  it.each([
    // [label, scrollOffset, rowCount, visibleRowCount, expected]
    ["table fits in viewport", 3, 5, 10, 0],
    ["table exactly fills viewport", 0, 5, 5, 0],
    ["clamps to max valid offset", 18, 20, 5, 15],
    ["preserves valid offset", 10, 20, 5, 10],
    ["zero-row table", 5, 0, 5, 0],
    ["degenerate visible count (0)", 5, 20, 0, 0],
    ["degenerate visible count (-1)", 5, 20, -1, 0],
    ["negative offset clamps to 0", -3, 20, 5, 0],
  ] as const)("%s", (_label, offset, rows, vis, expected) => {
    expect(clampScrollOffset(offset, rows, vis)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("toggleFocusedTable", () => {
  it("toggles between active and done", () => {
    expect(toggleFocusedTable(stateWith({ focusedTable: "active" })).focusedTable).toBe("done")
    expect(toggleFocusedTable(stateWith({ focusedTable: "done" })).focusedTable).toBe("active")
  })

  it("preserves selection indices, scroll offsets, and view mode", () => {
    const s = toggleFocusedTable(
      stateWith({
        focusedTable: "active",
        activeSelectedIndex: 3,
        doneSelectedIndex: 1,
        activeScrollOffset: 5,
        doneScrollOffset: 2,
      }),
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.doneSelectedIndex).toBe(1)
    expect(s.activeScrollOffset).toBe(5)
    expect(s.doneScrollOffset).toBe(2)
    expect(s.viewMode).toBe("dashboard")
  })
})

// ---------------------------------------------------------------------------
// Up/Down navigation — table-driven across active and done
// ---------------------------------------------------------------------------

describe("moveSelection (up/down, both tables)", () => {
  const VIS = 5

  it.each([
    ["active", "active", 2, 1],
    ["done", "done", 3, 2],
  ] as const)("moveSelectionUp decrements %s index", (_label, table, start, expected) => {
    const key = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
    const s = moveSelectionUp(stateWith({ focusedTable: table, [key]: start }), VIS)
    expect(sel(s, table)).toBe(expected)
  })

  it.each([
    ["active", "active", 1, 10, 3, 2],
    ["done", "done", 0, 5, 3, 1],
  ] as const)(
    "moveSelectionDown increments %s index",
    (_label, table, start, aCnt, dCnt, expected) => {
      const key = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
      const s = moveSelectionDown(stateWith({ focusedTable: table, [key]: start }), aCnt, dCnt, VIS)
      expect(sel(s, table)).toBe(expected)
    },
  )

  it("clamps at zero on moveUp", () => {
    const s = moveSelectionUp(stateWith({ focusedTable: "active", activeSelectedIndex: 0 }), VIS)
    expect(s.activeSelectedIndex).toBe(0)
  })

  it.each([
    ["active at last row", "active", 4, 5, 3, 4],
    ["done at last row", "done", 2, 5, 3, 2],
  ] as const)("clamps at last row: %s", (_label, table, start, aCnt, dCnt, expected) => {
    const key = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
    const s = moveSelectionDown(stateWith({ focusedTable: table, [key]: start }), aCnt, dCnt, VIS)
    expect(sel(s, table)).toBe(expected)
  })

  // Empty-table invariant: index and offset stay at 0 for both directions × both tables
  it.each([
    ["up", "active"],
    ["up", "done"],
    ["down", "active"],
    ["down", "done"],
  ] as const)("move%s on empty %s table keeps index and offset at 0", (dir, table) => {
    const base = stateWith({ focusedTable: table })
    const s =
      dir === "up"
        ? moveSelectionUp(base, VIS)
        : moveSelectionDown(base, table === "active" ? 0 : 5, table === "done" ? 0 : 5, VIS)
    expect(sel(s, table)).toBe(0)
    expect(scroll(s, table)).toBe(0)
  })

  it("does not affect the other table's index or scroll offset", () => {
    const s = moveSelectionDown(
      stateWith({
        focusedTable: "done",
        activeSelectedIndex: 3,
        activeScrollOffset: 7,
        doneSelectedIndex: 1,
      }),
      5,
      10,
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.activeScrollOffset).toBe(7)
  })

  // Viewport scrolling invariant — tested for both tables in one table-driven block
  it.each([
    ["active", "active", "down", 4, 0, 5, 1],
    ["done", "done", "down", 4, 0, 5, 1],
    ["active", "active", "up", 5, 5, 4, 4],
    ["done", "done", "up", 5, 5, 4, 4],
  ] as const)(
    "%s table scrolls %s when selection crosses viewport boundary",
    (_label, table, dir, startIdx, startScroll, expectedIdx, expectedScroll) => {
      const selKey = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
      const scrollKey = table === "active" ? "activeScrollOffset" : "doneScrollOffset"
      const base = stateWith({ focusedTable: table, [selKey]: startIdx, [scrollKey]: startScroll })
      const s =
        dir === "down"
          ? moveSelectionDown(base, 20, 20, VIS)
          : moveSelectionUp(base, VIS)
      expect(sel(s, table)).toBe(expectedIdx)
      expect(scroll(s, table)).toBe(expectedScroll)
    },
  )

  it.each([
    ["active down within viewport", "active", "down", 2, 0, 3, 0],
    ["done down within viewport", "done", "down", 2, 0, 3, 0],
    ["active up within viewport", "active", "up", 3, 0, 2, 0],
  ] as const)(
    "no scroll when selection stays within viewport: %s",
    (_label, table, dir, startIdx, startScroll, expectedIdx, expectedScroll) => {
      const selKey = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
      const scrollKey = table === "active" ? "activeScrollOffset" : "doneScrollOffset"
      const base = stateWith({ focusedTable: table, [selKey]: startIdx, [scrollKey]: startScroll })
      const s =
        dir === "down"
          ? moveSelectionDown(base, 20, 20, VIS)
          : moveSelectionUp(base, VIS)
      expect(sel(s, table)).toBe(expectedIdx)
      expect(scroll(s, table)).toBe(expectedScroll)
    },
  )
})

// ---------------------------------------------------------------------------
// Viewport boundary precision (regression protection)
// ---------------------------------------------------------------------------

describe("viewport boundary precision", () => {
  const VIS = 5

  it("selection at exact bottom boundary does not scroll", () => {
    // viewport [3..7], move to row 7
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 6, activeScrollOffset: 3 }),
      20, 5, VIS,
    )
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3) // row 7 = offset 3 + 5 - 1
  })

  it("selection one past bottom boundary triggers minimal scroll", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 7, activeScrollOffset: 3 }),
      20, 5, VIS,
    )
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4) // scrolled by exactly 1
  })

  it("selection at exact top boundary does not scroll", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4, activeScrollOffset: 3 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.activeScrollOffset).toBe(3)
  })

  it("selection one past top boundary triggers minimal scroll", () => {
    const s = moveSelectionUp(
      stateWith({ focusedTable: "active", activeSelectedIndex: 3, activeScrollOffset: 3 }),
      VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(2) // scrolled by exactly 1
  })

  it("viewport never centers the selection after boundary crossing", () => {
    const s = moveSelectionDown(
      stateWith({ focusedTable: "active", activeSelectedIndex: 4, activeScrollOffset: 0 }),
      20, 5, VIS,
    )
    expect(s.activeSelectedIndex).toBe(5)
    expect(s.activeScrollOffset).toBe(1) // at bottom, not centered
  })

  it("rapid sequential down movements produce consistent minimal scrolling", () => {
    let s = stateWith({ focusedTable: "active", activeScrollOffset: 0 })

    for (let i = 0; i < 10; i++) {
      s = moveSelectionDown(s, 20, 5, VIS)
    }

    expect(s.activeSelectedIndex).toBe(10)
    expect(s.activeScrollOffset).toBe(6) // 10 - 5 + 1
    expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
    expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
  })
})

// ---------------------------------------------------------------------------
// Enter detail
// ---------------------------------------------------------------------------

describe("enterDetail", () => {
  it.each([
    ["active with items → detail", "active", 5, 3, "detail"],
    ["done with items → detail", "done", 0, 2, "detail"],
  ] as const)("%s", (_label, table, aCnt, dCnt, expectedMode) => {
    const s = enterDetail(stateWith({ focusedTable: table }), aCnt, dCnt)
    expect(s.viewMode).toBe(expectedMode)
  })

  it.each([
    ["active empty → no-op", "active", 0, 3],
    ["done empty → no-op", "done", 5, 0],
  ] as const)("%s", (_label, table, aCnt, dCnt) => {
    const before = stateWith({ focusedTable: table })
    expect(enterDetail(before, aCnt, dCnt)).toEqual(before)
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
      5, 3,
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
    expect(returnFromDetail()).toEqual(initialDashboardFocusState())
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
      5, 5, VIS, VIS,
    )
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.doneSelectedIndex).toBe(3)
  })

  it("clamps both indices independently when tables shrink", () => {
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 10, doneSelectedIndex: 10 }),
      3, 2, VIS, VIS,
    )
    expect(s.activeSelectedIndex).toBe(2) // 3-1
    expect(s.doneSelectedIndex).toBe(1)   // 2-1
  })

  it("resets to 0 when a table becomes empty", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 5, activeScrollOffset: 10,
        doneSelectedIndex: 3, doneScrollOffset: 7,
      }),
      0, 0, VIS, VIS,
    )
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
    expect(s.doneScrollOffset).toBe(0)
  })

  it("preserves focused table and view mode (does not reset context)", () => {
    const s = clampAfterRefresh(
      stateWith({ focusedTable: "done", viewMode: "detail", doneSelectedIndex: 4 }),
      5, 3, VIS, VIS,
    )
    expect(s.focusedTable).toBe("done")
    expect(s.viewMode).toBe("detail")
  })

  it("clamps scroll offset when table shrinks below viewport", () => {
    // Had 20 rows with offset 15, table shrinks to 3 (fits in viewport of 5)
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 2, activeScrollOffset: 15 }),
      3, 5, VIS, VIS,
    )
    expect(s.activeScrollOffset).toBe(0) // table fits, offset must be 0
  })

  it("clamps scroll offset to max valid value and ensures selection visible", () => {
    // Had 20 rows with offset 15, table shrinks to 8 → max offset = 3
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 2, activeScrollOffset: 15 }),
      8, 5, VIS, VIS,
    )
    // clampScrollOffset(15, 8, 5) → 3, ensureVisible(3, 2, 5) → 2
    expect(s.activeScrollOffset).toBe(2)
    expect(s.activeSelectedIndex).toBe(2)
  })

  it("ensures selected row remains visible after clamping", () => {
    // Selection at 7, offset at 10, table shrinks to 8 → selection clamps to 7
    const s = clampAfterRefresh(
      stateWith({ activeSelectedIndex: 7, activeScrollOffset: 10 }),
      8, 5, VIS, VIS,
    )
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3) // viewport [3..7], row 7 visible
  })

  it("handles independent visible row counts per table", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 9, activeScrollOffset: 5,
        doneSelectedIndex: 4, doneScrollOffset: 2,
      }),
      10, 5,
      3,  // active visible
      10, // done visible
    )
    expect(s.activeSelectedIndex).toBe(9)
    expect(s.activeScrollOffset).toBe(7) // max offset for active
    expect(s.doneSelectedIndex).toBe(4)
    expect(s.doneScrollOffset).toBe(0)   // 5 rows fits in 10 visible
  })

  it("clamps both tables independently when both shrink (regression)", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 15, activeScrollOffset: 12,
        doneSelectedIndex: 10, doneScrollOffset: 8,
      }),
      6, 4, VIS, VIS,
    )
    // active: selection → 5, offset → max(0, 6-5)=1, ensureVisible(1,5,5)=1
    expect(s.activeSelectedIndex).toBe(5)
    expect(s.activeScrollOffset).toBe(1)
    // done: selection → 3, 4 rows <= 5 visible → offset 0
    expect(s.doneSelectedIndex).toBe(3)
    expect(s.doneScrollOffset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Per-table viewport independence
// ---------------------------------------------------------------------------

describe("per-table viewport independence", () => {
  const VIS = 5

  it.each([
    ["active nav does not affect done", "active", "done", 7],
    ["done nav does not affect active", "done", "active", 3],
  ] as const)("%s", (_label, focused, other, otherScroll) => {
    const scrollKey = other === "active" ? "activeScrollOffset" : "doneScrollOffset"
    const selKey = focused === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
    let s = stateWith({
      focusedTable: focused,
      [selKey]: 4,
      [focused === "active" ? "activeScrollOffset" : "doneScrollOffset"]: 0,
      [scrollKey]: otherScroll,
    })
    s = moveSelectionDown(s, 20, 20, VIS)
    expect(scroll(s, focused)).toBe(1) // scrolled
    expect(scroll(s, other)).toBe(otherScroll) // unchanged
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
    expect(s).toEqual(initialDashboardFocusState())
  })

  it("refresh preserves focus on done table while clamping", () => {
    let s = stateWith({ focusedTable: "done", activeSelectedIndex: 3, doneSelectedIndex: 4 })

    s = clampAfterRefresh(s, 5, 2, VIS, VIS)
    expect(s.focusedTable).toBe("done")
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.doneSelectedIndex).toBe(1) // clamped from 4 to 1
  })

  it("tab to empty table, press enter, nothing happens", () => {
    let s = toggleFocusedTable(stateWith({ focusedTable: "active" }))
    const before = { ...s }
    s = enterDetail(s, 5, 0)
    expect(s).toEqual(before)
    expect(s.viewMode).toBe("dashboard")
  })

  it("navigating a long table scrolls viewport correctly in both directions", () => {
    let s = initialDashboardFocusState()
    const ROWS = 20

    for (let i = 0; i < 7; i++) s = moveSelectionDown(s, ROWS, 5, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3) // 7 - 5 + 1

    for (let i = 0; i < 4; i++) s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(3)
    expect(s.activeScrollOffset).toBe(3) // row 3 at top of viewport

    s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(2) // scrolled up to reveal row 2
  })

  it("refresh after scrolling preserves visible context", () => {
    let s = stateWith({ focusedTable: "active", activeSelectedIndex: 7, activeScrollOffset: 5 })

    // Same count — nothing changes
    s = clampAfterRefresh(s, 20, 10, VIS, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(5)

    // Shrink to 8 rows — selection valid, offset clamps
    s = clampAfterRefresh(s, 8, 10, VIS, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.activeScrollOffset).toBe(3)
  })

  it("short tables keep scroll offset at zero", () => {
    let s = initialDashboardFocusState()

    s = moveSelectionDown(s, 3, 3, VIS)
    expect(s.activeScrollOffset).toBe(0)
    s = moveSelectionDown(s, 3, 3, VIS)
    expect(s.activeSelectedIndex).toBe(2)
    expect(s.activeScrollOffset).toBe(0)

    s = clampAfterRefresh(s, 3, 3, VIS, VIS)
    expect(s.activeScrollOffset).toBe(0)
  })

  it("single-row table keeps scroll offset at zero", () => {
    let s = stateWith({ focusedTable: "active" })
    s = moveSelectionDown(s, 1, 5, VIS)
    expect(s.activeSelectedIndex).toBe(0)
    expect(s.activeScrollOffset).toBe(0)
  })

  it("active and done tables maintain independent viewport state through navigation", () => {
    let s = initialDashboardFocusState()

    // Scroll active table down
    for (let i = 0; i < 8; i++) s = moveSelectionDown(s, 20, 20, VIS)
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4)
    expect(s.doneSelectedIndex).toBe(0)
    expect(s.doneScrollOffset).toBe(0)

    // Tab to done, scroll it independently
    s = toggleFocusedTable(s)
    for (let i = 0; i < 6; i++) s = moveSelectionDown(s, 20, 20, VIS)
    expect(s.doneSelectedIndex).toBe(6)
    expect(s.doneScrollOffset).toBe(2)

    // Active table state unchanged
    expect(s.activeSelectedIndex).toBe(8)
    expect(s.activeScrollOffset).toBe(4)

    // Tab back, navigate — done table unchanged
    s = toggleFocusedTable(s)
    s = moveSelectionUp(s, VIS)
    expect(s.activeSelectedIndex).toBe(7)
    expect(s.doneSelectedIndex).toBe(6)
    expect(s.doneScrollOffset).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Selected-row-visible invariant (exhaustive)
// ---------------------------------------------------------------------------

describe("selected-row-visible invariant", () => {
  const VIS = 5

  it("selected row is always within the visible slice after any navigation", () => {
    let s = initialDashboardFocusState()
    const ROWS = 30

    for (let i = 0; i < ROWS - 1; i++) {
      s = moveSelectionDown(s, ROWS, 10, VIS)
      expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
      expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
    }

    for (let i = 0; i < ROWS - 1; i++) {
      s = moveSelectionUp(s, VIS)
      expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
      expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
    }
  })

  it("selected row is within visible slice after refresh clamping", () => {
    const s = clampAfterRefresh(
      stateWith({
        activeSelectedIndex: 18, activeScrollOffset: 15,
        doneSelectedIndex: 12, doneScrollOffset: 10,
      }),
      10, 8, VIS, VIS,
    )

    expect(s.activeSelectedIndex).toBeGreaterThanOrEqual(s.activeScrollOffset)
    expect(s.activeSelectedIndex).toBeLessThan(s.activeScrollOffset + VIS)
    expect(s.doneSelectedIndex).toBeGreaterThanOrEqual(s.doneScrollOffset)
    expect(s.doneSelectedIndex).toBeLessThan(s.doneScrollOffset + VIS)
  })

  it("visible slice contains exactly the expected rows after scrolling", () => {
    let s = initialDashboardFocusState()
    const allRows = Array.from({ length: 20 }, (_, i) => `row-${i}`)

    for (let i = 0; i < 7; i++) s = moveSelectionDown(s, allRows.length, 5, VIS)

    const visibleSlice = allRows.slice(s.activeScrollOffset, s.activeScrollOffset + VIS)
    expect(visibleSlice).toEqual(["row-3", "row-4", "row-5", "row-6", "row-7"])
    expect(visibleSlice).toContain(`row-${s.activeSelectedIndex}`)
  })
})
