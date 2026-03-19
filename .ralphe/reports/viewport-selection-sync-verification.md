# Verification Report: Synchronize Selection Movement With Minimal Scrolling

**Date:** 2026-03-19
**Status:** PASS

## Summary

The feature correctly synchronizes keyboard-driven selection movement with viewport scrolling using minimal scrolling rules. All acceptance criteria are met.

## Implementation Review

### Core Files
- **`apps/ralphe/src/tui/dashboardFocus.ts`** (204 lines) — Pure state logic: `ensureVisible`, `clampScrollOffset`, `moveSelectionUp`, `moveSelectionDown`, `clampAfterRefresh`
- **`apps/ralphe/src/tui/DashboardView.tsx`** — Renders only visible slice via `tasks.slice(scrollOffset, scrollOffset + visibleRowCount)`, passes viewport props per table
- **`apps/ralphe/src/tui/WatchApp.tsx`** — Integrates keyboard handlers with state transitions, passes `visibleRowCount` to movement functions

### Test Files
- **`apps/ralphe/tests/dashboardFocus.test.ts`** (765 lines) — 53+ test cases covering all viewport/selection scenarios
- **`apps/ralphe/tests/dashboard.test.ts`** (328 lines) — View rendering and `computeVisibleRowCounts` tests

## Acceptance Criteria Verification

### 1. Moving selection within the visible window does not change the viewport
**PASS** — `ensureVisible()` returns `scrollOffset` unchanged when `selectedIndex >= scrollOffset && selectedIndex < scrollOffset + visibleRowCount`. Tested explicitly in "returns offset unchanged when selection is within viewport" and "handles selection at exact viewport top/bottom boundary" tests.

### 2. Moving selection above the visible window scrolls up only enough to reveal the selected row
**PASS** — `ensureVisible()` returns `selectedIndex` (snaps viewport top to selection) when `selectedIndex < scrollOffset`. This is minimal upward scrolling. Tested in "scrolls up when selection is above viewport" test.

### 3. Moving selection below the visible window scrolls down only enough to reveal the selected row
**PASS** — `ensureVisible()` returns `selectedIndex - visibleRowCount + 1` when `selectedIndex >= scrollOffset + visibleRowCount`. This places the selected row at the bottom of the viewport. Tested in "scrolls down when selection is below viewport" and "handles selection one past bottom boundary" tests.

### 4. The selected row remains visible in both the active and done tables during navigation
**PASS** — `moveSelectionUp` and `moveSelectionDown` both call `ensureVisible` for the focused table. `clampAfterRefresh` calls `ensureVisible` on BOTH tables independently. Per-table viewport independence is explicitly tested. End-to-end scenarios test navigation across both tables with tab switching.

### 5. The behavior stays consistent with the existing focused-table model and does not introduce centered scrolling
**PASS** — `toggleFocusedTable` preserves all selection indices and scroll offsets. Only the focused table's state is modified during navigation. The "does not center the selection" test explicitly verifies that `ensureVisible` does NOT center (e.g., offset=10, selection=14, viewport=10 → offset stays 10, not 9).

## Test Results

All tests pass:
```
342 pass
0 fail
661 expect() calls
Ran 342 tests across 21 files. [4.42s]
```

## Architecture Notes

- All viewport logic is pure and deterministic (no side effects)
- Selected index is full-table absolute (not viewport-relative)
- Each table tracks independent scroll offsets
- `computeVisibleRowCounts` derives viewport capacity from terminal height with 2:1 active/done split
- Rendering uses `tasks.slice(scrollOffset, scrollOffset + visibleRowCount)` for efficiency
