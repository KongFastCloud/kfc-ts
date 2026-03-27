# Verification Report: Bottom Row 50:50 Epic/Done Pane Split

**Date:** 2026-03-27
**Task:** Rebalance bottom row to 50-50 epic and done panes
**Result:** PASS

## Acceptance Criteria Verification

### 1. Dashboard bottom row renders epic and done panes at equal width
**PASS**

- `DashboardView.tsx` lines 957-1002: Both bottom panes use `flexGrow: 1, flexShrink: 0, flexBasis: 0` — confirmed equal flex allocation.
- Epic pane wrapper (line 959): `flexGrow: 1`
- Done pane wrapper (line 981): `flexGrow: 1`
- Previously the split was approximately 1:2 (epic:done), introduced in commit `815c5d2` with a `0.68` ratio, later changed to `1/3:2/3` in `0d3efe0`.

### 2. computePaneWidths returns equal share pane estimates and preserves non-negative widths
**PASS**

- `computePaneWidths()` (line 757-801):
  - `epicPaneWidth = Math.floor(terminalWidth / 2)` (line 767)
  - `donePaneWidth = Math.floor(terminalWidth / 2)` (line 768)
- Both use `Math.floor` for conservative estimates that never exceed actual flex allocation.
- All column widths are clamped with `Math.max(0, ...)` to prevent negative values.
- `dashboard.test.ts` includes comprehensive tests:
  - Equal share assertion at tw=120: both = `Math.floor(120/2) = 60`
  - Sum never exceeds terminal width (sweep 20-300)
  - Non-negative widths at all tested terminal widths (20-200)
  - Pane estimates individually ≤ `Math.ceil(tw/2)` (sweep with odd/even widths)

### 3. Existing right-edge safety invariants still pass after ratio change
**PASS**

- All 899 tests pass across 45 test files (0 failures).
- `dashboard.test.ts` right-edge invariant tests verified:
  - Bottom pane widths sum ≤ terminal width (sweep 20-300)
  - Done row content fits within pane width (sweep 92-120)
  - Epic row content fits within pane width (sweep 40-120)
  - Active row content fits terminal width at odd widths
- `narrowTerminal.test.ts` regression tests verified:
  - All column widths non-negative across narrow sweep (20-80)
  - Bottom pane widths never exceed terminal width (20-80)
  - Title widths monotonically non-decreasing (20-200)
  - Cross-layer consistency (panes + header + footer) at 60-160

### 4. No scheduler, watcher, or keybinding behavior changes
**PASS**

- Changes are confined to `DashboardView.tsx` (layout and width computation only).
- No modifications to scheduler, watcher, focus, or keybinding code.
- Test suite confirms no regressions across all 899 tests.

## Minor Finding (Non-blocking)

- **Stale comment on line 746**: JSDoc says "The bottom row uses flexGrow 1 (epic) : 2 (done)" but the actual code uses 1:1. The inline comment on line 758 correctly says "1:1". This is cosmetic and does not affect behavior.

## Test Execution

```
899 pass
0 fail
5443 expect() calls
Ran 899 tests across 45 files. [7.72s]
```

## Commit History (relevant changes)

- `815c5d2` — introduced 0.68/0.32 split
- `0d3efe0` — changed to 1/3 / 2/3
- `e2d8604` — refined floor estimates, still 1/3 / 2/3
- Current HEAD — 1/2 / 1/2 (50:50 split)
