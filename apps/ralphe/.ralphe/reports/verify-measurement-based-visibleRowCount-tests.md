# Verification Report: Update tests for measurement-based visibleRowCount

**Date:** 2026-03-20
**Status:** PASS

## Summary

All acceptance criteria for the test updates are met. The old `computeVisibleRowCounts` tests have been removed, new `deriveVisibleRowCount` tests cover edge cases, and all existing viewport regression tests pass.

## Acceptance Criteria Verification

### 1. computeVisibleRowCounts tests are removed
- **PASS**: Grep for `computeVisibleRowCounts` in `apps/ralphe/src/` and `apps/ralphe/tests/` returns zero matches. The function and its tests no longer exist.

### 2. New tests cover height-to-row-count derivation edge cases
- **PASS**: `dashboard.test.ts` contains a `deriveVisibleRowCount` describe block (lines 275-310) with 7 test cases:
  - Subtracts `TABLE_CHROME_LINES` from measured height (normal case)
  - Returns 0 when measured height is 0
  - Returns 0 when measured height equals `TABLE_CHROME_LINES`
  - Returns 0 when measured height is less than `TABLE_CHROME_LINES` (tests 1, 2, 3)
  - Returns 1 when measured height is one more than `TABLE_CHROME_LINES`
  - Handles large heights correctly (100 → 96, 500 → 496)
  - Clamps negative measured heights to 0

### 3. TABLE_CHROME_LINES test
- **PASS**: Separate describe block (lines 312-317) verifies `TABLE_CHROME_LINES` equals 4 (border-top + border-bottom + section title + column header).

### 4. All existing viewport regression tests pass
- **PASS**: `dashboardFocus.test.ts` has 72 tests across multiple describe blocks covering:
  - `ensureVisible`, `clampScrollOffset` pure functions
  - `toggleFocusedTable`, `moveSelectionUp`, `moveSelectionDown`
  - `enterDetail`, `returnFromDetail`, `clampAfterRefresh`
  - Per-table viewport independence
  - End-to-end focus scenarios
  - Viewport regression: per-table state transitions
  - Viewport regression: selection-to-viewport synchronization
  - Viewport regression: refresh clamping
  - Viewport regression: empty and short tables
  - Viewport regression: visible-slice contract

### 5. bun test passes with no failures
- **PASS**: `bun test` across both files: **134 tests pass, 0 failures, 387 expect() calls**.

## Source Code Verification

- `deriveVisibleRowCount` is exported from `apps/ralphe/src/tui/DashboardView.tsx` (line 501)
- It is used in the component at line 386: `const count = deriveVisibleRowCount(measuredHeight)`
- `TABLE_CHROME_LINES` is also exported and tested

## Test Output

```
bun test v1.3.9
 134 pass
 0 fail
 387 expect() calls
Ran 134 tests across 2 files. [23.00ms]
```
