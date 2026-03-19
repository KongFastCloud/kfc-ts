# Verification: Replace Done-Table Label Column With Completed Datetime

**Date:** 2026-03-19
**Status:** PASS

## Summary

The implementation correctly replaces the Label column in the done table with a Completed datetime column while preserving the Label column in the active table.

## Acceptance Criteria Verification

### 1. Active table keeps its existing Label column — PASS
- `DashboardTableHeader` renders "Label" when `variant === "active"` (line 211)
- `DashboardRow` renders `task.labels.join(", ")` or "—" for active variant (lines 263-268)
- Active table passes `variant="active"` in `DashboardView` (line 472)

### 2. Done table replaces Label with a Completed column — PASS
- `DashboardTableHeader` renders "Completed" when `variant === "done"` (line 211)
- `DashboardRow` renders `formatCompletedAt(task.closedAt)` for done variant (lines 260-262)
- Done table passes `variant="done"` in `DashboardView` (line 485)

### 3. Done rows render completion time in compact local format — PASS
- `formatCompletedAt()` converts ISO-8601 to `"Mar 19 7:41 PM"` format
- Uses 12-hour clock with AM/PM, short month name, day number
- Unit tests confirm format: `expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M$/)`
- Midnight renders as 12:XX AM, noon renders as 12:XX PM

### 4. Done rows render — when completion time is unavailable — PASS
- `formatCompletedAt(undefined)` returns "—"
- `formatCompletedAt("")` returns "—"
- `formatCompletedAt("not-a-date")` returns "—"
- All cases covered by unit tests

### 5. No alteration to dashboard status semantics or detail view — PASS
- Changes are scoped to `DashboardView.tsx` only (table rendering)
- `TableVariant` type ("active" | "done") controls column divergence
- No status mapping or detail view code modified
- `partitionTasks` logic unchanged
- `WatchApp.tsx` detail view rendering unaffected

## Test Results

| Test Suite | Tests | Pass | Fail |
|---|---|---|---|
| dashboard.test.ts | 12 | 12 | 0 |
| dashboardDurationRegression.test.ts | 36 | 36 | 0 |
| duration.test.ts | 22 | 22 | 0 |

- TypeScript type-check: clean (no errors)

## Implementation Details

- `formatCompletedAt()` exported from `DashboardView.tsx` for testability
- Uses `task.closedAt` field from WatchTask model as completion timestamp source
- Column width reuses existing `COL.label` (14 chars), with truncation applied to fit
- Single-line rows preserved; title clipping maintained
