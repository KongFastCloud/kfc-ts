# Verification: Refresh-Regression Coverage for Selection, Viewport, and Remount Safety

**Date:** 2026-03-23
**Status:** PASS
**PRD:** prd/ralphe-watch-tui-selection-preservation.md

## Summary

All five acceptance criteria have regression test coverage. Tests pass (31/31 in the dedicated regression file, 80/80 in the supporting dashboardFocus test file, 14/14 in the controller lifecycle tests).

## Acceptance Criteria Verification

### AC-1: Selection survives controller-driven refresh when selected task remains valid
**Status:** COVERED
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 119-187)
**Tests:**
- Active table selection index unchanged after refresh with same row count
- Done table selection index unchanged after refresh with same row count
- Selection survives when table grows (tasks added)
- Selection survives repeated refreshes with stable task list (5 consecutive)
- Focused table is never reset by a data-only refresh

### AC-2: Viewport/scroll preservation when selected row remains valid and visible
**Status:** COVERED
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 193-263)
**Tests:**
- Scroll offset unchanged when selection remains within viewport after refresh
- Both tables maintain independent scroll offsets through refresh
- Scroll offset unchanged after repeated refreshes with stable data (5 consecutive)
- Selected row remains within visible viewport slice after refresh (invariant check)
- Scroll adjusts minimally when table shrinks but selection remains valid

### AC-3: Detail-view preservation across ordinary refreshes
**Status:** COVERED
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 269-339)
**Tests:**
- Detail view on active table survives refresh when selected task is valid
- Detail view on done table survives refresh when selected task is valid
- Detail view survives multiple consecutive refreshes (10 iterations)
- Detail view survives refresh when table grows
- Detail view + scroll offset both survive refresh together

### AC-4: Invalid selections clamp/fall back only when task becomes unavailable
**Status:** COVERED
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 345-446)
**Tests:**
- Selection clamps to last valid index when table shrinks (not reset to 0)
- Selection resets to 0 only when table becomes completely empty
- Detail view falls back to dashboard only when focused table empties
- Detail view on done table falls back only when done table empties
- Unfocused table clamping does not affect focused table or view mode
- Scroll offset clamps proportionally (not reset to 0) when table shrinks

### AC-5: Mount-lifecycle safety (controller updates do not reset local state)
**Status:** COVERED
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 452-592)
**Tests:**
- Controller state-change listeners receive updates without resetting
- Multiple sequential refreshes emit state changes (never a full reset)
- Listener subscription survives across multiple refreshes (no re-subscribe needed)
- removeStateChangeListener stops delivery without affecting other listeners
- Controller getState() returns consistent snapshot (immutable state)
- Periodic refresh delivers state changes without resetting task list

## Integration Tests
**File:** `apps/ralphe/tests/selectionPreservationRegression.test.ts` (lines 598-705)
- Navigate active table → refresh → verify selection + scroll + mode intact
- Enter detail → refresh → detail and selection preserved
- Navigate + scroll deep → partial shrink → selection clamps, scroll adjusts, mode preserved
- Refresh distinguishes data update from remount: state preserved, tasks updated

## Implementation Architecture Verified
- `WatchSession.tsx`: Single-mount React boundary that subscribes to controller state via `useState`/`useEffect`, ensuring React reconciliation preserves local dashboard state across refreshes.
- `dashboardFocus.ts`: Pure state logic with `clampAfterRefresh()` that preserves valid selections and only clamps when tasks become unavailable.
- `tuiWatchController.ts`: Controller with `onStateChange`/`removeStateChangeListener` subscription API for React integration.

## Test Execution Results
```
selectionPreservationRegression.test.ts: 31 pass, 0 fail, 94 expect() calls [236ms]
dashboardFocus.test.ts: 80 pass, 0 fail, 279 expect() calls [10ms]
tuiWatchController.test.ts: 14 pass, 0 fail, 29 expect() calls [664ms]
```

## Conclusion
All acceptance criteria are fully covered with regression tests. The tests correctly distinguish between refresh-as-data-update (preserves state) and refresh-as-remount (eliminated by the WatchSession boundary). The implementation and tests are traceable to the PRD.
