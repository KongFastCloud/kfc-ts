# Verification Report: Harden dashboard pane width budgeting

**Date:** 2026-03-26
**Task:** kfc-ts-kko7 — Fix ralphe watch TUI right-edge cutoff
**Status:** PASS

## What was verified

### 1. TypeScript compilation
- `pnpm --filter ralphe run typecheck` passes cleanly with zero errors.
- The previous error (turbo typecheck exit code 2) is resolved.

### 2. Test suite
- All **838 tests** across 41 files pass (2275 expect() calls), including the `computePaneWidths` regression tests.

### 3. Width budgeting implementation (`DashboardView.tsx`)

#### Constants
- `WIDTH_SAFETY_MARGIN = 6` — explicit slack for rounding drift between flex engine and our estimates.
- `PANE_CHROME = 4` — accounts for left/right borders + padding.
- `COL` object defines fixed column widths (id: 12, idTitleSep: 3, status: 12, ready: 14, priority: 5, duration: 10, completedDone: 22, epicStatus: 22).

#### `computePaneWidths(terminalWidth)` function (lines 753-793)
- **Bottom row split:** Epic gets `Math.floor(terminalWidth / 3)` (conservative floor), Done gets the remainder. Both clamped to min 24.
- **Active pane:** Title width = `terminalWidth - activeFixedWidth - WIDTH_SAFETY_MARGIN`, clamped to >= 0.
- **Epic pane:** Budget = `epicPaneWidth - PANE_CHROME - WIDTH_SAFETY_MARGIN`. Status column gets priority allocation, title gets the rest. All values clamped to >= 0.
- **Done pane:** Budget = `donePaneWidth - PANE_CHROME - WIDTH_SAFETY_MARGIN`. Completed column gets priority, title gets the rest. All values clamped to >= 0.

#### Layout invariant: right-edge safety
- Every width derivation uses `Math.max(0, ...)` to prevent negative values.
- The safety margin absorbs rounding differences between the flex engine and our integer math.
- Title columns shrink first, then dynamic columns (epicStatus, completedDone), fixed columns never shrink.

### 4. Footer/help text truncation (`WatchApp.tsx`)

The `WatchFooter` component:
- Reads live terminal width via `useTerminalDimensions()`.
- Computes `safeWidth = Math.max(0, termWidth - 2)` to account for padding.
- Truncates navigation shortcuts to `safeWidth` using the `truncate()` helper.
- Footer text will never exceed the available terminal width.

### 5. Test coverage for width safety (dashboard.test.ts, lines 326-430)

Regression tests cover:
- Non-negative title widths at 80, 40, and 20 columns.
- Bottom pane split matches 1:2 flex ratio (conservative floor for epic).
- Bottom pane widths sum to at most terminal width (tested at 60, 80, 100, 120, 150, 200, 300).
- Active row content fits within terminal width at multiple widths.
- Done row content fits within its pane width at multiple widths.
- Epic row content fits within its pane width at multiple widths.
- Title widths grow as terminal width increases.
- Dynamic columns (epicStatus, doneCompleted) reach full width at wide terminals.
- Dynamic columns shrink gracefully at narrow terminals.
- All column widths remain non-negative at any terminal width (20-200).

### 6. Layout structure preserved
- Active pane: full-width on top (flexGrow: 2).
- Bottom row: Epics on the left (flexGrow: 1), Done on the right (flexGrow: 2).
- StatsFooter bar rendered between active and bottom panes.

## Acceptance criteria check

| Criterion | Status |
|-----------|--------|
| Active, Epic, Done panes derive width budgets conservatively | PASS |
| Bottom-row split remains Epics left, Done right | PASS |
| Column-width math preserves readable titles respecting pane limits | PASS |
| Implementation stays local to watch TUI layout layer | PASS |
| TypeScript compiles without errors | PASS |
| All tests pass | PASS |

## Conclusion

The implementation correctly hardens dashboard pane width budgeting with conservative width derivation, explicit slack constants, Math.max(0, ...) clamping at every step, and footer text truncation. The previous typecheck failure is resolved. All 838 tests pass including comprehensive width regression coverage.
