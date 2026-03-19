# Verification Report: Render Dashboard Tables From Visible Row Windows

**Date:** 2026-03-19
**Status:** PASS

## Summary

The dashboard viewport rendering feature has been correctly implemented. Both dashboard tables (active and done) now render only the visible row slice based on explicit application state, replacing the previous passive scroll behavior.

## Acceptance Criteria Verification

### 1. Each dashboard table renders only the visible row slice for its current viewport
**PASS** - `DashboardTable` component (DashboardView.tsx:347) computes `visibleSlice = tasks.slice(scrollOffset, scrollOffset + visibleRowCount)` and renders only that slice. The `scrollOffset` and `visibleRowCount` are passed as explicit props from application state.

### 2. Section title and column header remain fixed while rows change underneath
**PASS** - `DashboardSectionTitle` and `DashboardTableHeader` are rendered outside the row body container with `flexShrink: 0` and fixed `height: 1`. Only the inner `<box style={{ flexGrow: 1 }}>` contains the visible row slice. This ensures chrome stays pinned.

### 3. Row rendering continues to assume one row equals one terminal line
**PASS** - `DashboardRow` renders with `height: 1` and `flexShrink: 0`. All column values are computed inline as single-line strings using `pad()` and `truncate()`.

### 4. The active and done tables both use the visible-window rendering model
**PASS** - `DashboardView` passes `scrollOffset` and `visibleRowCount` to both `DashboardTable` instances (active at line 530, done at line 545). Both use identical slice-based rendering logic.

### 5. The slice does not introduce detail-view rendering changes or dashboard sort changes
**PASS** - `DetailPane` in WatchApp.tsx is unchanged and renders independently of the viewport model. Task partitioning (`partitionTasks`) preserves adapter ordering. No sort logic was modified.

## Implementation Details Verified

### State Model (dashboardFocus.ts)
- `DashboardFocusState` includes per-table `scrollOffset` fields (activeScrollOffset, doneScrollOffset)
- `ensureVisible()` implements minimal scrolling (no centering)
- `clampScrollOffset()` constrains offsets to valid range
- `moveSelectionUp/Down()` adjust scroll offset via `ensureVisible()`
- `clampAfterRefresh()` preserves context while clamping both indices and offsets
- `returnFromDetail()` resets all scroll offsets to 0

### Visible Row Computation (DashboardView.tsx)
- `computeVisibleRowCounts()` derives per-table row capacity from terminal height
- Subtracts 2 for header/footer, splits remaining 2:1 between active/done
- Subtracts TABLE_CHROME_LINES (4) per table for borders, title, and header
- Never returns negative values

### WatchApp Integration (WatchApp.tsx)
- Derives `activeVisibleRows` and `doneVisibleRows` from terminal height
- Passes correct visible row count to keyboard handlers for viewport-aware navigation
- Refresh callback uses `clampAfterRefresh()` with both visible row counts
- All scroll/selection state flows through `DashboardFocusState` as single source of truth

## Test Results

All 313 tests pass across 20 test files (0 failures).

Relevant test coverage:
- **dashboardFocus.test.ts**: 48 tests covering viewport helpers (ensureVisible, clampScrollOffset), navigation with scroll adjustment, refresh clamping with scroll preservation, per-table viewport independence, and end-to-end scenarios
- **dashboard.test.ts**: 7 tests for `computeVisibleRowCounts` covering typical/tall/small terminals, non-negative guarantees, and chrome accounting
- **dashboardDurationRegression.test.ts**: Duration calculation regression tests (unrelated to viewport, confirming no regressions)

## Key Design Invariants Confirmed

1. Row visibility is a function of explicit application state, not terminal scroll side effects
2. Selected row always remains visible after navigation and refresh
3. Viewport scrolls minimally (never centers)
4. Active and done tables maintain independent scroll state
5. Tab switching preserves both tables' scroll offsets
6. Empty/short tables keep scroll offset at zero
