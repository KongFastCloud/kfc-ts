# Verification: Preserve detail-view and clamp-on-invalid refresh behavior

**Date:** 2026-03-23
**Status:** ✅ PASS

## Summary

Verified that the implementation correctly preserves detail-view and dashboard context across ordinary refreshes, and only changes selection or view state when the currently selected task becomes invalid after a data update.

## Acceptance Criteria Verification

### ✅ AC1: A refresh that keeps the selected task valid preserves the current dashboard/detail context

**Evidence:**
- `clampAfterRefresh()` in `dashboardFocus.ts` (lines 172–211) preserves `focusedTable`, `viewMode`, selection indices, and scroll offsets when table sizes have not changed or when the selected index is still within bounds.
- Test: "preserves detail view when the selected task remains valid (active table)" — passes
- Test: "preserves detail view when the selected task remains valid (done table)" — passes
- Test: "preserves dashboard context (focus, selection, scroll) when tasks are unchanged" — passes
- Test: "detail view survives multiple sequential refreshes with stable task list" — passes (3 sequential refreshes with identical counts)

### ✅ AC2: A refresh only changes selection or current view when the selected task becomes invalid or unavailable

**Evidence:**
- `clampAfterRefresh()` only clamps selection to `Math.min(currentIndex, count - 1)` — never resets to 0 unless the table becomes empty.
- View mode falls back to "dashboard" only when `state.viewMode === "detail" && focusedTableEmpty` (lines 198–201).
- Test: "clamps selection but preserves detail view when focused table shrinks (not empty)" — selection moves from 7 → 3 when table shrinks to 4, but viewMode stays "detail"
- Test: "falls back to dashboard when focused table (active) empties during detail view" — viewMode changes to "dashboard" only when activeCount becomes 0
- Test: "falls back to dashboard when focused table (done) empties during detail view" — same for done table
- Test: "does not change dashboard viewMode when focused table empties (was already dashboard)" — no spurious mode change
- Test: "only clamps — never resets to 0 — when table shrinks but stays non-empty" — selection goes from 8 → 5, not 0

### ✅ AC3: Existing focus-clamping behavior remains the only intentional path for refresh-time selection correction

**Evidence:**
- `WatchApp.tsx` (lines 587–596) triggers `clampAfterRefresh()` via a `useEffect` when the `tasks` reference changes. This is the single entry point for refresh-time selection correction.
- No other code paths modify focus state during refresh. The controller emits new task data through the `WatchSession` subscription, which updates `controllerState` via React's `useState`, triggering a re-render that fires the clamping effect.
- The single-mount `WatchSession` boundary (rendered once per TUI lifetime) ensures that controller updates flow through React reconciliation rather than root re-mounts, so local state is never destroyed by the refresh cycle.

### ✅ AC4: The slice does not add new navigation behavior outside the PRD scope

**Evidence:**
- No new keyboard handlers, no new navigation transitions, no new state fields.
- The only addition to `clampAfterRefresh()` vs the pre-existing clamping logic is the `viewMode` fallback for empty focused tables (lines 198–201), which is a correctness guard for the detail-view preservation contract.
- The `dashboardFocus.ts` module contains no routing, no task ordering, and no refresh triggers.

## Test Results

```
451 pass, 0 fail, 994 expect() calls
Ran 451 tests across 24 files. [5.03s]
```

The `dashboardFocus.test.ts` suite alone contains 80 tests with 279 assertions, including a dedicated "refresh-preservation: detail view and clamp-on-invalid" describe block with 9 targeted tests covering:
- Detail view preservation on stable refresh (both tables)
- Selection clamping with detail view preserved (non-empty shrink)
- Detail-to-dashboard fallback on focused table emptying (both tables)
- Dashboard mode unaffected by focused table emptying
- Full context preservation on no-change refresh
- Clamp-only semantics (never reset to 0 for non-empty tables)
- Multi-refresh survival

## Architecture

1. **`dashboardFocus.ts`** — Pure state machine: `clampAfterRefresh()` is the single refresh-time correction path.
2. **`WatchApp.tsx`** — React component: holds focus state in `useState`, runs `clampAfterRefresh` in `useEffect` when tasks change.
3. **`WatchSession.tsx`** — Single-mount boundary: subscribes to controller state changes via React `useState`+`useEffect`, ensuring local UI state survives refreshes.
4. **`tuiWatchController.ts`** — Controller: owns task data, emits state change events. UI is a consumer, not re-created.

This layering ensures that refresh-time state correction is confined to pure clamping logic, and the rendering architecture preserves local state by design.
