# Verification Report: Lock Dashboard Viewport Behavior With Regression Coverage

**Date:** 2026-03-19
**Status:** PASS

## Summary

Verified that comprehensive regression test coverage was added for the dashboard viewport-scrolling model. All 169 tests across 3 test files pass (133 dashboard focus/view tests + 36 duration regression tests).

## Acceptance Criteria Verification

### 1. Tests cover per-table viewport state transitions for the active and done tables
**PASS** — `dashboardFocus.test.ts` contains dedicated sections:
- `"viewport regression: per-table state transitions"` (5 tests) covering done table scroll-down, scroll-up, no-scroll-within-viewport, long done table navigation, and independent active/done navigation
- `"per-table viewport independence"` (3 tests) verifying that navigation in one table does not affect the other's scroll offset, and tab switching preserves both offsets
- Both `moveSelectionUp` and `moveSelectionDown` describe blocks include viewport adjustment tests for both active and done tables

### 2. Tests cover selection movement within, above, and below the visible window
**PASS** — `"viewport regression: selection-to-viewport synchronization"` (6 tests) covers:
- Selection at exact bottom boundary (no scroll)
- Selection one past bottom boundary (minimal scroll)
- Selection at exact top boundary (no scroll)
- Selection one past top boundary (minimal scroll)
- Viewport never centers after boundary crossing
- Rapid sequential down movements produce consistent minimal scrolling
- Additional coverage in `moveSelectionUp` and `moveSelectionDown` describe blocks

### 3. Tests cover refresh clamping for both selection and scroll offset
**PASS** — `"viewport regression: refresh clamping"` (5 tests) plus `"clampAfterRefresh"` (13 tests):
- Done table scroll offset clamping on shrink
- Done table selection clamping with visibility enforcement
- Independent scroll position preservation when sizes unchanged
- Both tables clamping independently when both shrink
- Scroll context preservation after refresh
- Empty table reset to 0
- Selection remains visible after clamping (visible-slice contract tests)

### 4. Tests cover empty-table and short-table viewport behavior
**PASS** — `"viewport regression: empty and short tables"` (8 tests):
- moveSelectionUp/Down on empty active table keeps index and offset at 0
- moveSelectionUp/Down on empty done table keeps index and offset at 0
- Short done table keeps scroll offset at zero throughout navigation
- Refresh preserves zero offset when tables remain short
- Table growing from empty to populated keeps selection at 0
- Single-row table keeps scroll offset at zero
- Additional: `computeVisibleRowCounts` (7 tests) covers zero/negative terminal heights

### 5. Regression coverage protects the explicit dashboard viewport contract without introducing unrelated feature scope
**PASS** — `"viewport regression: visible-slice contract"` (5 tests):
- Visible slice contains exactly the expected rows after scrolling
- Visible slice of a short table equals the full table
- Visible slice is empty for an empty table
- Selected row is always within visible slice after any navigation (exhaustive 30-row traversal)
- Selected row is within visible slice after refresh clamping
- All tests are pure-state/helper-driven, no fragile rendering assumptions
- No unrelated feature scope introduced

## Test Execution

```
bun test v1.3.11
133 pass, 0 fail (dashboardFocus.test.ts + dashboard.test.ts)
387 expect() calls

36 pass, 0 fail (dashboardDurationRegression.test.ts)
50 expect() calls
```

## Implementation Quality

- **Pure state functions** — All viewport logic is in `dashboardFocus.ts` as pure functions (`ensureVisible`, `clampScrollOffset`, `moveSelectionUp/Down`, `clampAfterRefresh`)
- **Deterministic tests** — No terminal rendering, no timing, no flakiness
- **Extends prior art** — Builds on existing dashboard focus test foundation without replacing it
- **Per-table independence** — Active and done tables maintain fully independent `scrollOffset` and `selectedIndex`
- **Minimal scrolling** — `ensureVisible()` never centers; only scrolls enough to reveal the selected row
