# Verification Report: Explicit Viewport State For Dashboard Tables

**Date:** 2026-03-19
**Status:** PASS

## Summary

The implementation correctly adds explicit per-table viewport state to the dashboard interaction model. All 71 tests pass, TypeScript compiles cleanly, and the implementation satisfies all acceptance criteria.

## Acceptance Criteria Verification

### 1. Dashboard interaction state includes explicit per-table scroll offset values
**PASS** — `DashboardFocusState` interface in `dashboardFocus.ts` includes `activeScrollOffset: number` and `doneScrollOffset: number` alongside the existing `focusedTable`, `activeSelectedIndex`, `doneSelectedIndex`, and `viewMode` fields. Initial state factory sets both offsets to 0.

### 2. Refresh-state clamping keeps both selection and scroll offsets valid
**PASS** — `clampAfterRefresh()` accepts per-table visible row counts, clamps selection indices to `[0, count-1]`, clamps scroll offsets via `clampScrollOffset()` to `[0, max(0, rowCount - visibleRowCount)]`, then runs `ensureVisible()` to guarantee the selected row is within the viewport. Tests cover: table shrinking, tables becoming empty, independent visible row counts per table.

### 3. The state model keeps the selected row visible without requiring centered scrolling
**PASS** — `ensureVisible()` scrolls minimally: snaps viewport top to selection if above, scrolls down just enough if below, and leaves offset unchanged if already visible. Explicit test: `"does not center the selection"` verifies no centering behavior.

### 4. The viewport state remains independent for the active and done tables
**PASS** — Navigation on the active table does not modify `doneScrollOffset` and vice versa. Tab switching preserves both tables' scroll offsets. Dedicated test suite `"per-table viewport independence"` (3 tests) verifies this.

### 5. The slice stays limited to dashboard table state and does not change detail scrolling behavior
**PASS** — `DashboardView.tsx` still uses passive `<scrollbox>` for rendering (unchanged). The detail pane (`DetailPane` in `WatchApp.tsx`) also uses its own `<scrollbox>` and is untouched by viewport state changes. The viewport state is purely in the state model layer (`dashboardFocus.ts`), with integration in keyboard handlers in `WatchApp.tsx`.

## Test Results

```
bun test v1.3.11
71 pass, 0 fail, 130 expect() calls
```

### Test Coverage Breakdown
- `ensureVisible()` — 9 unit tests (boundary conditions, degenerate viewport, no centering)
- `clampScrollOffset()` — 7 unit tests (fits, clamp max, empty table, negative)
- `moveSelectionUp` — 7 tests including scroll adjustment
- `moveSelectionDown` — 10 tests including scroll adjustment
- `clampAfterRefresh` — 12 tests including scroll offset clamping and visibility enforcement
- Per-table viewport independence — 3 dedicated tests
- End-to-end integration scenarios — 7 tests including long-table scrolling, refresh-after-scroll

## TypeScript Compilation
Clean — no errors.

## Files Modified
- `apps/ralphe/src/tui/dashboardFocus.ts` — Added `activeScrollOffset`, `doneScrollOffset` to state; added `ensureVisible()`, `clampScrollOffset()` helpers; updated `moveSelectionUp`, `moveSelectionDown`, `clampAfterRefresh` to maintain viewport.
- `apps/ralphe/src/tui/WatchApp.tsx` — Integrated viewport state: passes `DEFAULT_VISIBLE_ROW_COUNT` to navigation and refresh transitions.
- `apps/ralphe/tests/dashboardFocus.test.ts` — Comprehensive viewport test coverage (expanded from prior selection-only tests).

## Scope Compliance
- No new dashboard features added
- No detail scrolling changes
- No new keyboard semantics beyond what supports the viewport contract
- State model is pure/deterministic — no dependency on passive scrollbox behavior
