# Verification Report: Sort Done Table By Completion Time Descending

**Date:** 2026-03-19
**Status:** PASS

## Summary

The done-table sorting feature is correctly implemented. Done tasks are sorted by `closedAt` timestamp descending (newest first), with invalid/missing timestamps falling to the bottom in stable original order. The non-done/active table is unaffected.

## Implementation Details

### Core Function: `sortDoneTasks` (DashboardView.tsx, lines 200-218)
- Tags each task with its original index and parsed timestamp
- Sorts with a comparator that:
  - Places valid timestamps before invalid/missing ones
  - Orders valid timestamps descending (newest first)
  - Preserves original index order among invalid/missing entries
- Returns the sorted task array

### Integration Point (DashboardView.tsx, line 538)
- After `partitionTasks()` splits tasks into `active` and `unsortedDone` buckets
- `sortDoneTasks(unsortedDone)` is applied only to the done bucket
- Active bucket is passed through unchanged

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Done-table rows ordered by completion timestamp descending | PASS | Test "sorts done tasks by closedAt descending" passes |
| Non-done/top table keeps existing order | PASS | Test "active bucket keeps adapter ordering regardless of done sorting" passes |
| Missing/invalid timestamps fall below valid rows | PASS | Tests for missing and invalid closedAt pass |
| Stable order among equally missing/invalid timestamps | PASS | Test "preserves original order among tasks with equally missing/invalid closedAt" passes |
| Regression coverage | PASS | 33 tests in dashboard.test.ts + 36 tests in dashboardDurationRegression.test.ts all pass |

## Test Results

- `apps/ralphe/tests/dashboard.test.ts`: **33 pass, 0 fail** (55 expect calls)
- `apps/ralphe/tests/dashboardDurationRegression.test.ts`: **36 pass, 0 fail** (50 expect calls)

## Scope Confirmation

- Only done-table ordering is changed; active table uses original adapter order
- Sort is applied in the dashboard layer (DashboardView component), not in global query/adapter
- No changes to completion datetime formatting, viewport behavior, or active-table sorting
