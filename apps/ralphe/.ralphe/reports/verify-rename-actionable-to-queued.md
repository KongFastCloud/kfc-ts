# Verification Report: Rename actionable status to queued

**Date:** 2026-03-20
**Status:** PASS

## Summary

The rename of `actionable` to `queued` across the ralphe codebase has been correctly implemented.

## Acceptance Criteria Verification

### WatchTaskStatus type uses 'queued' not 'actionable'
**PASS** — `beadsAdapter.ts` line 31 defines `| "queued"` in the WatchTaskStatus union type. No reference to `'actionable'` exists in the type definition.

### Dashboard displays 'queued' instead of 'actionable'
**PASS** — Both `WatchApp.tsx` and `DashboardView.tsx` use `queued` as the key in `taskStatusColor` and `taskStatusIndicator` records. The indicator (`○`) and color mapping are preserved.

### queryActionable renamed to queryQueued with updated imports
**PASS** — `beadsAdapter.ts` exports `queryQueued`. Imports in `watcher.ts`, `tuiWorker.ts`, and `index.ts` all reference `queryQueued`. No `queryActionable` function exists anywhere in the codebase.

### All existing tests pass with updated string values
**PASS** — All 364 tests across 21 test files pass (0 failures, 851 expect() calls).

### No remaining references to 'actionable' as a status in apps/ralphe source
**PASS** — Zero matches for `actionable` in `apps/ralphe/src/`. The only remaining occurrences are in `tests/beadsAdapter.test.ts`:
- Line 603: Comment ("Actionable filtering — only queued tasks are eligible...")
- Line 606-607: Describe block name and comment referencing the old `queryActionable` name for historical context
- Line 708: Test fixture title string `"Actionable"` (not a status value, just a display name for test data)

These are all in comments or test fixture display names, not status string literals. They do not affect behavior.

## Key Files Verified

| File | Change |
|------|--------|
| `src/beadsAdapter.ts` | WatchTaskStatus type, mapStatus(), queryQueued(), MARK_READY_ELIGIBLE, NON_DONE_STATUSES |
| `src/watcher.ts` | Import of queryQueued |
| `src/tuiWorker.ts` | Import and usage of queryQueued |
| `src/index.ts` | Re-export of queryQueued |
| `src/tui/WatchApp.tsx` | statusColor and statusIndicator keyed by 'queued' |
| `src/tui/DashboardView.tsx` | statusColor, statusIndicator, computeDuration, NON_DONE_STATUSES keyed by 'queued' |
| `README.md` | Documentation references 'queued' |
| All 21 test files | Pass with updated string values |

## Test Results

```
364 pass
0 fail
851 expect() calls
Ran 364 tests across 21 files. [4.41s]
```
