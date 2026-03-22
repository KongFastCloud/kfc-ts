# Verification: Collapse dashboardFocus permutations into invariant-driven coverage

**Date:** 2026-03-22
**Status:** PASS
**Commit:** 97d6bb7

## Test Execution

```
bun test v1.3.11

 72 pass
 0 fail
 272 expect() calls
Ran 72 tests across 1 file. [95.00ms]
```

All tests pass successfully.

## Acceptance Criteria Verification

### 1. Core invariant coverage retained ✅

The test file (595 lines) covers all required invariants across 11 describe blocks:

| Invariant | Test Section | Status |
|-----------|-------------|--------|
| Initial focus state | `initialDashboardFocusState` | ✅ |
| Focus toggling | `toggleFocusedTable` | ✅ |
| Visibility rules | `ensureVisible` (7 table-driven + 2 edge cases) | ✅ |
| Clamping rules | `clampScrollOffset` (8 table-driven cases) | ✅ |
| Detail transitions | `enterDetail` (4 table-driven + 1 preservation) | ✅ |
| Return from detail | `returnFromDetail` reset verification | ✅ |
| Refresh clamping | `clampAfterRefresh` (9 tests) | ✅ |
| Per-table independence | Table-driven across both tables | ✅ |
| Selected-row-visible | Exhaustive sweep (30 rows) + refresh + slice content | ✅ |
| Viewport boundary precision | 5 table-driven + sequential scroll regression | ✅ |

### 2. Repetitive permutations collapsed into table-driven tests ✅

- **9 `it.each()` blocks** replace mirrored active/done permutations
- **24 individual `it()` calls** remain for tests needing distinct setup or integration flows
- Helper functions `sel()` and `scroll()` enable table-driven parameterization by table name
- `stateWith()` helper reduces boilerplate for state construction

Key consolidations:
- `moveSelection` up/down: Previously separate per-table tests → single `it.each()` parameterized by `(dir, table)`
- Empty-table invariant: 4 permutations (up/down × active/done) in one `it.each()`
- Viewport scrolling: Both tables × both directions in one `it.each()`
- `enterDetail`: 4 permutations (populated/empty × active/done) in one `it.each()`
- Per-table independence: Both directions in one `it.each()`

### 3. Viewport regression protection preserved ✅

The `viewport boundary precision` describe block preserves historically meaningful regression tests:
- Exact bottom boundary (no scroll)
- One past bottom boundary (minimal scroll)
- Exact top boundary (no scroll)
- One past top boundary (minimal scroll)
- Never-centers invariant
- Rapid sequential scrolling consistency (10 steps)

End-to-end scenarios also include:
- Long table bidirectional scrolling
- Refresh after scrolling preserves visible context
- Short and single-row tables keep scroll at zero
- Independent viewport state through cross-table navigation

## Code Reduction Metrics

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| File lines | ~1150 | 595 | ~48% |
| Commit diff | — | -863 / +406 | net -457 lines |
| Runtime tests | ~100 | 72 | ~28% fewer |
| `it.each()` blocks | 0 | 9 | table-driven |

## Conclusion

The implementation correctly collapses dashboardFocus permutations into invariant-driven coverage. All 72 tests pass. The suite is approximately 48% shorter while preserving all meaningful invariant coverage and viewport regression protection. Table-driven patterns replace mirrored permutations effectively.
