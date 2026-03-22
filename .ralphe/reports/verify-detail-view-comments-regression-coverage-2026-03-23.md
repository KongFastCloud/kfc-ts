# Verification: Detail View Comments Regression Coverage

**Date:** 2026-03-23
**Status:** PASS
**Test file:** `apps/ralphe/tests/detailViewCommentsRegression.test.ts`

## Summary

All 29 regression tests pass across 5 acceptance criteria groups plus a boundary enforcement group. The test suite locks in the corrected detail-view behavior as specified in the PRD (`prd/ralphe-detail-view-comments.md`).

## Test Results

```
bun test v1.3.9 — 29 pass, 0 fail, 89 expect() calls [209ms]
```

Related suites also pass (beadsAdapter, selectionPreservationRegression, tuiWatchController): 123 pass, 0 fail.

## Acceptance Criteria Verification

### AC-1: Comments/activity appear in the detail pane ✅
- `fetchTaskDetail` returns comments from full detail data (3 comments verified)
- Comment author and timestamp available for rendering
- Task with no comments has `undefined` comments
- Multiline comment text preserved intact

### AC-2: Detail rendering uses the full-detail query path ✅
- `queryTaskDetail` is invoked (not `queryAllTasks`) when entering detail view
- List snapshot does not carry comments — detail path is required
- Detail data contains fields (description, comments) absent from list snapshot
- Adapter `parseBdTaskList` produces tasks without comments from list-style JSON
- Adapter `parseBdTaskList` preserves comments from detail-style JSON

### AC-3: Comments are chronologically ordered ✅
- Comments arrive sorted oldest-first from the adapter (out-of-order input sorted)
- Controller detail state preserves chronological order
- Single comment handled correctly (no sorting edge case)
- Comments with identical timestamps maintain stable order

### AC-4: Detail context preserved across refreshes ✅
- Refresh re-fetches detail for the currently viewed task
- `detailTaskId` stays the same across refresh
- Detail data is updated (re-resolved) after refresh, not stale
- Refresh without open detail view does not trigger detail fetch
- Exiting detail view before refresh prevents re-fetch
- Stale detail result from a previous task is discarded after navigation

### AC-5: Detail-fetch loading and failure states ✅
- `detailLoading` is true while fetch is in flight
- `detailError` is set when task is not found
- `detailError` is set when fetch throws (FatalError)
- Successful fetch clears any previous error
- `exitDetailView` clears loading, error, and detail state
- Detail re-fetch failure during refresh is non-fatal — does not clear `detailTaskId`
- State change listeners fire for loading, success, and error transitions

### Boundary enforcement: dashboard list vs detail data ✅
- `queryAllTasks` and `queryTaskDetail` are independent code paths
- `latestTasks` (list) and `detailTask` (detail) are independent state
- Exiting detail view does not affect the dashboard list

## Implementation Verified

- **Controller** (`tuiWatchController.ts`): `fetchTaskDetail`, `exitDetailView`, `detailTask/detailLoading/detailError/detailTaskId` state, refresh-safe re-resolution
- **Adapter** (`beadsAdapter.ts`): `WatchTaskComment` interface, `queryTaskDetail` function, chronological comment sorting in `parseBdTaskList`
- **Separation**: Dashboard list path (`queryAllTasks`) and detail path (`queryTaskDetail`) are independent code paths with independent state
