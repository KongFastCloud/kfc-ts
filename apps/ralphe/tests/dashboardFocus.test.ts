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
    ["degenerate viewport (0)", 5, 3, 0, 0],
    ["degenerate viewport (-1)", 5, 3, -1, 0],
    ["single-row viewport: visible", 5, 5, 1, 5],
    ["single-row viewport: above", 5, 3, 1, 3],
    ["single-row viewport: below", 5, 7, 1, 7],
  ] as const)("%s", (_label, offset, idx, vis, expected) => {
    expect(ensureVisible(offset, idx, vis)).toBe(expected)
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

  // Navigation, boundary clamping, and empty-table cases in one table
  it.each([
    // [label, dir, table, startIdx, aCnt, dCnt, expectedIdx]
    ["up active decrements",     "up",   "active", 2, 10, 3, 1],
    ["up done decrements",       "up",   "done",   3, 5,  10, 2],
    ["down active increments",   "down", "active", 1, 10, 3, 2],
    ["down done increments",     "down", "done",   0, 5,  3, 1],
    ["clamps at top (active)",   "up",   "active", 0, 5,  3, 0],
    ["clamps at top (done)",     "up",   "done",   0, 5,  3, 0],
    ["clamps at bottom (active)","down", "active", 4, 5,  3, 4],
    ["clamps at bottom (done)",  "down", "done",   2, 5,  3, 2],
    ["empty active up",          "up",   "active", 0, 0,  5, 0],
    ["empty done up",            "up",   "done",   0, 5,  0, 0],
    ["empty active down",        "down", "active", 0, 0,  5, 0],
    ["empty done down",          "down", "done",   0, 5,  0, 0],
  ] as const)(
    "%s",
    (_label, dir, table, start, aCnt, dCnt, expected) => {
      const key = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
      const base = stateWith({ focusedTable: table, [key]: start })
      const s =
        dir === "up"
          ? moveSelectionUp(base, VIS)
          : moveSelectionDown(base, aCnt, dCnt, VIS)
      expect(sel(s, table)).toBe(expected)
    },
  )

  // Viewport scrolling and boundary precision — both tables, both directions
  it.each([
    // [label, table, dir, startIdx, startScroll, rowCount, expectedIdx, expectedScroll]
    ["active crosses bottom",          "active", "down", 4, 0, 20, 5, 1],
    ["done crosses bottom",            "done",   "down", 4, 0, 20, 5, 1],
    ["active crosses top",             "active", "up",   5, 5, 20, 4, 4],
    ["done crosses top",               "done",   "up",   5, 5, 20, 4, 4],
    ["active within viewport (down)",  "active", "down", 2, 0, 20, 3, 0],
    ["done within viewport (down)",    "done",   "down", 2, 0, 20, 3, 0],
    ["active within viewport (up)",    "active", "up",   3, 0, 20, 2, 0],
    // Boundary precision cases (regression)
    ["at exact bottom — no scroll",        "active", "down", 6, 3, 20, 7, 3],
    ["one past bottom — minimal scroll",   "active", "down", 7, 3, 20, 8, 4],
    ["at exact top — no scroll",           "active", "up",   4, 3, 20, 3, 3],
    ["one past top — minimal scroll",      "active", "up",   3, 3, 20, 2, 2],
    ["never centers after boundary cross", "active", "down", 4, 0, 20, 5, 1],
  ] as const)(
    "viewport scroll: %s",
    (_label, table, dir, startIdx, startScroll, rowCount, expectedIdx, expectedScroll) => {
      const selKey = table === "active" ? "activeSelectedIndex" : "doneSelectedIndex"
      const scrollKey = table === "active" ? "activeScrollOffset" : "doneScrollOffset"
      const base = stateWith({ focusedTable: table, [selKey]: startIdx, [scrollKey]: startScroll })
      const s =
        dir === "down"
          ? moveSelectionDown(base, rowCount, rowCount, VIS)
          : moveSelectionUp(base, VIS)
      expect(sel(s, table)).toBe(expectedIdx)
      expect(scroll(s, table)).toBe(expectedScroll)
    },
  )

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

  // Per-table independence: navigation does not affect the other table
  it.each([
    ["active nav preserves done", "active", "done", 7],
    ["done nav preserves active", "done", "active", 3],
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
})

// ---------------------------------------------------------------------------
// Enter detail / Return from detail
// ---------------------------------------------------------------------------

describe("enterDetail", () => {
  it.each([
    // [label, table, aCnt, dCnt, expectedMode, isNoOp]
    ["active with items → detail", "active", 5, 3, "detail",    false],
    ["done with items → detail",   "done",   0, 2, "detail",    false],
    ["active empty → no-op",       "active", 0, 3, "dashboard", true],
    ["done empty → no-op",         "done",   5, 0, "dashboard", true],
  ] as const)("%s", (_label, table, aCnt, dCnt, expectedMode, isNoOp) => {
    const before = stateWith({ focusedTable: table })
    const s = enterDetail(before, aCnt, dCnt)
    expect(s.viewMode).toBe(expectedMode)
    if (isNoOp) expect(s).toEqual(before)
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

describe("returnFromDetail", () => {
  it("resets to initial state (top table, first row, dashboard mode)", () => {
    expect(returnFromDetail()).toEqual(initialDashboardFocusState())
  })
})

// ---------------------------------------------------------------------------
// Refresh clamping — table-driven invariants
// ---------------------------------------------------------------------------

describe("clampAfterRefresh", () => {
  const VIS = 5

  // Core clamping invariants collapsed into one table
  it.each([
    // [label, overrides, aCnt, dCnt, aVis, dVis, checks]
    [
      "preserves selection when tables did not shrink",
      { focusedTable: "done" as const, activeSelectedIndex: 2, doneSelectedIndex: 3 },
      5, 5, VIS, VIS,
      { activeSelectedIndex: 2, doneSelectedIndex: 3 },
    ],
    [
      "clamps both indices when tables shrink",
      { activeSelectedIndex: 10, doneSelectedIndex: 10 },
      3, 2, VIS, VIS,
      { activeSelectedIndex: 2, doneSelectedIndex: 1 },
    ],
    [
      "resets to 0 when tables become empty",
      { activeSelectedIndex: 5, activeScrollOffset: 10, doneSelectedIndex: 3, doneScrollOffset: 7 },
      0, 0, VIS, VIS,
      { activeSelectedIndex: 0, doneSelectedIndex: 0, activeScrollOffset: 0, doneScrollOffset: 0 },
    ],
    [
      "preserves focused table and view mode",
      { focusedTable: "done" as const, viewMode: "detail" as const, doneSelectedIndex: 4 },
      5, 3, VIS, VIS,
      { focusedTable: "done", viewMode: "detail" },
    ],
  ] as const)(
    "%s",
    (_label, overrides, aCnt, dCnt, aVis, dVis, checks) => {
      const s = clampAfterRefresh(stateWith(overrides), aCnt, dCnt, aVis, dVis)
      for (const [key, val] of Object.entries(checks)) {
        expect(s[key as keyof DashboardFocusState]).toBe(val)
      }
    },
  )

  // Scroll offset clamping — table-driven
  it.each([
    // [label, selIdx, scrollOffset, newCount, vis, expectedScroll]
    ["table shrinks below viewport → offset 0",    2, 15, 3, 5, 0],
    ["table shrinks to max valid offset",           2, 15, 8, 5, 2],
    ["selection visible after offset clamp",        7, 10, 8, 5, 3],
  ] as const)(
    "scroll clamping: %s",
    (_label, selIdx, scrollOff, newCount, vis, expectedScroll) => {
      const s = clampAfterRefresh(
        stateWith({ activeSelectedIndex: selIdx, activeScrollOffset: scrollOff }),
        newCount, 5, vis, VIS,
      )
      expect(s.activeScrollOffset).toBe(expectedScroll)
    },
  )

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
