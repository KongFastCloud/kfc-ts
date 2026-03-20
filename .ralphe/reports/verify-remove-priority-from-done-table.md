# Verification: Remove Priority from Done Table

**Date:** 2026-03-20
**Status:** PASS

## Summary

Verified that the priority column has been removed from the done table and the completed column has been widened from 14 to 22 characters, as specified in the PRD.

## Acceptance Criteria Verification

### 1. Done table rows do not render a priority segment — PASS

In `DashboardRow`, `priorityStr` is set to `""` when `isDone` is true (line 320-321), producing zero characters of output for the priority cell in done rows.

In `DashboardTableHeader`, when `variant === "done"`, the header renders `pad("Completed", COL.completedDone)` instead of `pad("Label", COL.label) + pad("Pri", COL.priority)`, omitting the priority header entirely.

### 2. Done table completed column renders at 22 characters wide — PASS

`COL.completedDone` is defined as `22` with the comment "Width of the Completed column in the done table (label 14 + priority 5 + separator 3)".

Both the header (`pad("Completed", COL.completedDone)`) and row (`pad(truncate(formatCompletedAt(...), COL.completedDone - 1), COL.completedDone)`) use this 22-char width for done variant.

### 3. Active table still renders priority column as before — PASS

When `variant !== "done"`:
- Header renders `pad("Label", COL.label) + pad("Pri", COL.priority)` (14 + 5 chars)
- Row renders `priorityStr = pad(task.priority !== undefined ? "P${task.priority}" : "—", COL.priority)` (5 chars)
- `activeFixedWidth` calculation includes both `COL.label` and `COL.priority`

### 4. Title column width remains correct in both tables — PASS

Separate fixed-width calculations ensure each table's title column fills remaining space:
- `activeFixedWidth = COL.id + COL.idTitleSep + COL.status + COL.label + COL.priority + COL.duration + 4 = 60`
- `doneFixedWidth = COL.id + COL.idTitleSep + COL.status + COL.completedDone + COL.duration + 4 = 63`

Math verified: for any terminal width, both active and done rows sum to exactly the terminal width (content + 4 padding/border chars).

### 5. Existing dashboard tests updated and passing — PASS

All test suites pass:
- `dashboard.test.ts`: 34 tests, 0 failures
- `dashboardFocus.test.ts`: 100 tests, 0 failures
- `dashboardDurationRegression.test.ts`: 36 tests, 0 failures

Total: 170 tests passing, 0 failures.

## Implementation Details

Three components were modified with variant-gated logic in `DashboardView.tsx`:

1. **`DashboardTableHeader`**: Uses `isDone` flag to conditionally render either `Completed` (22 chars) or `Label` + `Pri` headers.
2. **`DashboardRow`**: Uses `isDone` flag to render `fourthColStr` at `COL.completedDone` width for done rows, and sets `priorityStr` to empty string.
3. **`DashboardView`**: Computes separate `activeFixedWidth` / `doneFixedWidth` and passes corresponding `activeTitleWidth` / `doneTitleWidth` to each table.

The `COL` constant object was extended with `completedDone: 22` to define the wider completed column width.
