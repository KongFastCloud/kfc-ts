# Verification Report: Fixed 50/50 Active/Done Table Split

**Date:** 2026-03-20
**Status:** PASS

## What Was Verified

### 1. Active and Done tables each occupy exactly 50% of available vertical space
**PASS** — Both `DashboardTable` instances in `DashboardView.tsx` use `flexGrow={1}`:
- Line 575: Active table has `flexGrow={1}` (changed from `flexGrow={2}`)
- Line 591: Done table has `flexGrow={1}` (unchanged)

With both tables having equal `flexGrow` values of 1, they each receive 50% of the available flex space.

### 2. Layout does not shift when task counts change between tables
**PASS** — The `DashboardTable` container box (line 402) uses `flexShrink: 0`, preventing either table from yielding space when content changes. Combined with equal `flexGrow`, this ensures a stable 50/50 layout regardless of task counts.

### 3. Navigation and scrolling work correctly at new sizes
**PASS** — The `deriveVisibleRowCount` function (line 501-503) measures actual rendered height and subtracts `TABLE_CHROME_LINES` (4 lines for borders + title + header). This measurement-based approach is decoupled from the flex layout, so navigation and scrolling are unaffected by the layout change.

### 4. Existing deriveVisibleRowCount tests pass unchanged
**PASS** — All 34 tests in `apps/ralphe/tests/dashboard.test.ts` pass (0 failures, 55 expect() calls). The deriveVisibleRowCount tests (7 test cases covering normal operation, edge cases, and large heights) all pass without modification.

## Implementation Details

The change involved exactly the lines specified in the design:
- `DashboardView.tsx` line 575: `flexGrow={1}` on Active table (was `flexGrow={2}`)
- `DashboardView.tsx` line 402: `flexShrink: 0` on DashboardTable container (was `flexShrink: 1`)

Both values are confirmed correct in the current codebase.

## Test Results
```
bun test v1.3.9
 34 pass
 0 fail
 55 expect() calls
Ran 34 tests across 1 file. [24.00ms]
```
