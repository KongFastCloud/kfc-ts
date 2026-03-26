# Verification: Narrow-Terminal Regression Coverage for Watch TUI Layout

**Date:** 2026-03-26
**Task:** Add narrow-terminal regression coverage for watch TUI layout
**Parent Epic:** kfc-ts-kko7
**Status:** PASS

## Summary

The narrow-terminal regression coverage has been correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Regression coverage exists for pane-local width calculations in the split dashboard layout
**PASS** — `narrowTerminal.test.ts` contains a full "narrow-terminal pane width regression" suite with 8 tests:
- All column widths non-negative across 20–80 sweep (2601 expect() calls total)
- Bottom pane widths never exceed terminal width
- Active row content fits terminal (60–120 sweep)
- Active title collapses to 0 at narrow widths
- Done row content fits pane width (62–120 sweep)
- Epic row content fits pane width (57–120 sweep)
- Title widths monotonically non-decreasing (20–200 sweep)
- Dynamic columns never exceed their max
- Extremely narrow terminals (1–19) produce all-zero titles without crashing

### 2. Regression coverage exists for header/footer behavior under narrower terminal widths
**PASS** — Two test suites cover this:
- `narrowTerminal.test.ts` "narrow-terminal header width regression" (4 tests): error budget non-negative across 20–80, total header fits within content width, config variant, error budget collapses at narrow widths
- `narrowTerminal.test.ts` "narrow-terminal footer width regression" (4 tests): footer text + padding never exceeds terminal width (5–120 sweep), detail mode footer, empty at width 0, non-empty once wide enough
- `watchChrome.test.ts` (20 tests): comprehensive header right-width, error budget, and footer text coverage including truncation and shortcut visibility

### 3. Tests would fail if right-edge clipping were reintroduced
**PASS** — The tests assert strict `≤ terminalWidth` invariants using parametric sweeps across narrow widths. Any regression in width math (removing Math.floor, removing WIDTH_SAFETY_MARGIN, incorrect budget subtraction) would cause immediate test failures.

### 4. Focus/navigation coverage continues to pass with the new layout constraints
**PASS** — `dashboardFocus.test.ts` passes all 94 tests with 319 expect() calls.

## Implementation Quality

### Source implementation (`DashboardView.tsx`):
- `computePaneWidths()` uses conservative `Math.floor()` for both bottom pane widths
- Explicit `WIDTH_SAFETY_MARGIN = 6` and `PANE_CHROME = 4` constants
- All dynamic widths clamped with `Math.max(0, ...)`
- Priority-based column allocation: fixed columns first, dynamic columns next, title last

### Source implementation (`WatchApp.tsx`):
- `buildFooterText()` truncates to `termWidth - 2 - FOOTER_SAFETY_MARGIN`
- `computeHeaderErrorBudget()` returns `Math.max(0, ...)` ensuring non-negative budgets
- `computeHeaderRightWidth()` truncates task IDs to 16 chars max

### Cross-layer consistency test:
- Verifies pane widths, header, and footer are all safe at the same terminal width (60–160 sweep)

## Test Results

| Test File | Tests | Pass | Fail | expect() calls |
|-----------|-------|------|------|----------------|
| narrowTerminal.test.ts | 18 | 18 | 0 | 2601 |
| watchChrome.test.ts | 20 | 20 | 0 | 234 |
| dashboard.test.ts | 52 | 52 | 0 | 449 |
| dashboardFocus.test.ts | 94 | 94 | 0 | 319 |

TypeScript validation: **PASS** (no errors)

## Conclusion

The narrow-terminal regression coverage is comprehensive and correctly implemented. The tests cover all three layers (pane widths, header, footer) with parametric sweeps that would catch any future width-budget regression. The implementation uses conservative math throughout to prevent right-edge clipping.
