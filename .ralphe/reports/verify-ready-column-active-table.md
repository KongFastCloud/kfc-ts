# Verification Report: Replace Label Column with Ready Checkmark

**Date:** 2026-03-20
**Status:** PASS

## Summary

The implementation correctly replaces the 'Label' column with a 'Ready' column in the active (non-done) dashboard table.

## Acceptance Criteria Verification

### 1. Active table header shows 'Ready' instead of 'Label' — PASS
- Line 276: `pad("Ready", COL.ready)` renders in the active table header.
- No occurrences of `"Label"` remain in `DashboardView.tsx`.

### 2. Tasks with 'ready' label show a green checkmark in the Ready column — PASS
- Line 316: `task.labels?.includes("ready") ? "✓" : ""`
- Line 351: Color is `colors.status.success` (`#9ece6a`, green) for the active variant.

### 3. Tasks without 'ready' label show blank in the Ready column — PASS
- Line 316: Falls through to empty string `""` when label is absent.

### 4. Tasks being marked ready show dotted circle in the Ready column — PASS
- Line 314: `isMarkingReady ? pad("◌", COL.ready)` renders the loading indicator.
- Line 351: Color is `colors.fg.dim` (`#414868`, muted) when `isMarkingReady` is true.

### 5. Done table still shows 'Completed' header and timestamp — PASS
- Line 275: `isDone ? pad("Completed", COL.completedDone)` renders in the done header.
- Line 312: Done variant renders `formatCompletedAt(task.closedAt)` with `COL.completedDone` width.
- Color is `colors.accent.secondary` (`#bb9af7`) for done variant.

### 6. Column width unchanged (14 chars) — PASS
- Line 59: `COL.ready: 14` — width is 14 characters.

## Code Quality Checks

| Check | Result |
|-------|--------|
| TypeScript compilation (`tsc --noEmit`) | PASS — no errors |
| Unit tests (`bun test tests/dashboard.test.ts`) | PASS — 34/34 tests, 55 assertions |
| Linter (`oxlint`) | PASS — 0 errors (1 unrelated warning: unused `formatDuration` import) |
| No remnant `COL.label` references | PASS — 0 occurrences |
| No remnant `"Label"` header text | PASS — 0 occurrences |

## Files Verified

- `apps/ralphe/src/tui/DashboardView.tsx` — main implementation
- `apps/ralphe/tests/dashboard.test.ts` — unit tests
