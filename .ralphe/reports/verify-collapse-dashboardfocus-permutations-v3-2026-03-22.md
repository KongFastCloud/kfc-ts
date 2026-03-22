# Verification: Collapse dashboardFocus permutations into invariant-driven coverage

**Date:** 2026-03-22
**Status:** PASS

## Summary

The dashboardFocus test suite has been successfully collapsed from permutation-based coverage into invariant-driven, table-driven tests. All 71 tests pass with 254 expect() calls.

## Test Results

```
bun test v1.3.9
 71 pass
 0 fail
 254 expect() calls
Ran 71 tests across 1 file. [13.00ms]
```

## Code Reduction

- **Before:** ~1211 lines (estimated from diff: 919 lines deleted)
- **After:** 496 lines
- **Net reduction:** ~59% fewer lines of test code

Commits:
- `97d6bb7` — initial collapse of permutations into table-driven coverage
- `2a8c907` — further consolidation into invariant-driven coverage

## Acceptance Criteria Verification

### 1. Core invariant coverage retained

| Invariant | Covered | Test Section |
|---|---|---|
| Initial focus state | YES | `initialDashboardFocusState` (line 46) |
| Focus toggling | YES | `toggleFocusedTable` (line 104) |
| Visibility (ensureVisible) | YES | `ensureVisible` — 12 table-driven cases (line 64) |
| Clamping (clampScrollOffset) | YES | `clampScrollOffset` — 8 table-driven cases (line 84) |
| Navigation + boundary clamping | YES | `moveSelection` — 12 permutations + 12 viewport cases (line 132) |
| Detail entry and return | YES | `enterDetail` + `returnFromDetail` (lines 230-267) |
| Refresh clamping | YES | `clampAfterRefresh` — 9 cases including regression (line 273) |
| Per-table independence | YES | Independence tests in moveSelection (line 208) and e2e (line 417) |
| Selected-row-visible invariant | YES | Exhaustive loop + refresh + visible-slice verification (line 450) |

### 2. Repetitive permutations collapsed into table-driven tests

The following `it.each()` blocks replace what were previously separate mirrored test cases for active vs done tables:

- `ensureVisible`: 12 cases in one table (was separate tests)
- `clampScrollOffset`: 8 cases in one table
- `moveSelection`: 12 navigation cases + 12 viewport scroll cases covering both tables and both directions
- `enterDetail`: 4 cases (active/done × populated/empty)
- `clampAfterRefresh`: 4 core invariant cases + 3 scroll clamping cases

Helper functions (`sel()`, `scroll()`, `stateWith()`) enable table-driven tests to work across both table identities without code duplication.

### 3. Viewport regression protection preserved

- Boundary precision cases (exact top/bottom, one-past) retained at lines 174-178
- "Never centers" regression case retained at line 178
- Sequential rapid navigation consistency test retained at line 194
- Independent viewport state through navigation (e2e test at line 417)
- Visible slice content verification at line 485
- Refresh clamping with independent visible row counts at line 346
- Both-tables-shrink regression at line 330

## Conclusion

All three acceptance criteria are met. The test suite retains full invariant coverage while reducing code by ~59%. Table-driven tests make the contracts clearer and eliminate the mental diff between mirrored active/done permutations.
