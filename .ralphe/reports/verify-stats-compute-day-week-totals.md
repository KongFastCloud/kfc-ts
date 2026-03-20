# Verification: computeDayTotal and computeWeekTotal Pure Functions

**Date:** 2026-03-20
**Status:** PASS

## Summary

The `computeDayTotal` and `computeWeekTotal` pure functions are correctly implemented in `src/tui/statsCompute.ts` with comprehensive tests in `tests/statsCompute.test.ts`. All 23 tests pass.

## Implementation Review

**File:** `apps/ralphe/src/tui/statsCompute.ts`

- Exports `computeDayTotal(tasks, referenceDate)` and `computeWeekTotal(tasks, referenceDate)`
- Returns `{ totalMs: number, count: number }` (via `AggregateTotals` interface)
- Uses shared `aggregate()` helper with `[windowStart, windowEnd)` half-open interval
- `startOfDay()` sets hours to 00:00:00.000; day window = [midnight, next midnight)
- `startOfWeek()` correctly maps to Monday via `(getDay() + 6) % 7`; week window = [Monday 00:00, next Monday 00:00)
- `parseDate()` validates ISO-8601 strings, rejects empty/undefined/NaN
- Filters only `status === "done"` tasks
- Imports `WatchTask` from `beadsAdapter.ts` (no new types added)
- `referenceDate` parameter enables deterministic testing

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| computeDayTotal returns correct total for tasks finishing today | PASS |
| computeDayTotal excludes tasks finishing yesterday | PASS |
| computeWeekTotal returns correct total for tasks finishing this week (Mon-Sun) | PASS |
| computeWeekTotal excludes tasks finishing last week | PASS |
| Both functions exclude tasks with missing startedAt or finishedAt | PASS |
| Both functions exclude tasks with invalid/unparseable date strings | PASS |
| Both functions exclude non-done tasks | PASS |
| Both functions return { totalMs: 0, count: 0 } when no tasks match | PASS |
| Midnight boundary edge cases handled correctly | PASS |
| All tests pass via bun test | PASS (23/23) |

## Test Results

```
bun test v1.3.9
 23 pass
 0 fail
 23 expect() calls
Ran 23 tests across 1 file. [9.00ms]
```

### Test Coverage

**computeDayTotal (11 tests):**
- Correct total for tasks finishing today
- Excludes yesterday's tasks
- Excludes tomorrow's tasks
- Includes task at midnight (start of day)
- Excludes task at next midnight (end of day)
- Includes task at 23:59:59.999
- Excludes active/queued/error tasks
- Excludes tasks with missing startedAt
- Excludes tasks with missing finishedAt
- Excludes tasks with invalid date strings
- Returns zeros for empty list

**computeWeekTotal (12 tests):**
- Correct total for tasks finishing Mon-Sun
- Excludes previous Sunday (last week)
- Excludes next Monday (next week)
- Includes Monday midnight (start of week)
- Includes Sunday 23:59:59.999
- Excludes next Monday 00:00:00.000
- Excludes non-done tasks
- Excludes tasks with missing timestamps
- Excludes tasks with invalid date strings
- Returns zeros for empty list
- Handles referenceDate on a Monday
- Handles referenceDate on a Sunday
