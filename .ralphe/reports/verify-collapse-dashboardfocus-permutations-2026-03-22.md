# Verification: Collapse dashboardFocus permutations into invariant-driven coverage

**Date:** 2026-03-22
**Status:** PASS

## Summary

The dashboardFocus test suite has been successfully rationalized from repetitive permutation-based tests into invariant-driven, table-driven coverage. All 74 tests pass with 276 assertions.

## Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| File lines | ~1150 | 694 | -40% |
| `it()` calls | 100 | 47 | -53% |
| `it.each()` blocks | 0 | 11 | +11 |
| Test cases (runtime) | ~100 | 74 | -26% |
| Assertions | N/A | 276 | - |

The reduction from 100 individual `it()` calls to 47 (with 11 table-driven blocks expanding to 74 runtime tests) demonstrates effective consolidation of mirrored permutations.

## Acceptance Criteria Verification

### 1. Core invariant coverage retained

The following invariants have dedicated test coverage:

- **Initial focus state**: `initialDashboardFocusState` test verifies all fields in one `toEqual()` assertion (consolidated from 4 separate tests)
- **Focus toggling**: `toggleFocusedTable` tests verify both directions and state preservation
- **Visibility/clamping**: `ensureVisible` (7 table-driven cases + 2 edge cases), `clampScrollOffset` (8 table-driven cases)
- **Detail transitions**: `enterDetail` covers both tables with items, both empty, and state preservation; `returnFromDetail` verifies reset
- **Refresh clamping**: `clampAfterRefresh` has 9 tests covering preservation, independent clamping, empty tables, context preservation, offset clamping, and visibility
- **Per-table independence**: Dedicated `per-table viewport independence` describe block
- **Selected-row-visible invariant**: Exhaustive describe block with navigation sweep (30 rows up and down), refresh clamping, and visible-slice content verification

### 2. Repetitive permutations collapsed into table-driven tests

Key consolidations observed:

- **moveSelection up/down**: Previously separate tests for active and done tables are now `it.each()` blocks parameterized by table name using `sel()` and `scroll()` helper accessors
- **Empty table invariant**: All 4 permutations (up/down x active/done) in a single `it.each()` block
- **Viewport scrolling**: Cross-boundary scrolling for both tables and both directions in one `it.each()` block
- **enterDetail**: Populated and empty cases each use `it.each()` across both tables
- **Per-table independence**: Both directions (active-doesn't-affect-done, done-doesn't-affect-active) in one `it.each()` block

### 3. Viewport regression protection preserved

The `viewport boundary precision` describe block explicitly preserves historically meaningful regression tests:

- Exact bottom boundary (no scroll)
- One past bottom boundary (minimal scroll)
- Exact top boundary (no scroll)
- One past top boundary (minimal scroll)
- Never-centers invariant
- Rapid sequential scrolling consistency

These tests remain as individual explicit test cases (not table-driven) because they protect specific fragile viewport behaviors.

## Test Execution

```
bun test v1.3.9 (cf6cdbbb)
 74 pass
 0 fail
 276 expect() calls
Ran 74 tests across 1 file. [9.00ms]
```

## Conclusion

The implementation correctly collapses dashboardFocus permutations into invariant-driven coverage. The test suite is 40% shorter by line count while preserving all meaningful coverage. Table-driven patterns using `it.each()` replace mirrored active/done permutations, and the file header documents the invariants being tested rather than listing acceptance criteria. Viewport regression protection is explicitly preserved in a dedicated section.
