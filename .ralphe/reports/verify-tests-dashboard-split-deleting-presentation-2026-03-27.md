# Verification Report: Tests — Dashboard Split & Deleting Presentation Contracts

**Date:** 2026-03-27
**Epic:** kfc-ts-2k8t — Refine watch TUI split ratios and deleting status presentation
**Slice:** Tests — lock in new dashboard split and deleting presentation contracts

## Summary

All acceptance criteria are met. 79 tests pass across `dashboard.test.ts` and `narrowTerminal.test.ts` with 0 failures and 3080 expect() calls.

## Acceptance Criteria Verification

### 1. Dashboard test suite asserts 50:50 epic and done pane budget ✅

`dashboard.test.ts` line 486–493 contains an explicit contract guard:

```ts
it("both bottom panes use equal 50:50 budget (contract guard)", () => {
  for (const tw of [60, 80, 100, 120, 200]) {
    const w = computePaneWidths(tw)
    expect(w.epicPaneWidth).toBe(w.donePaneWidth)
  }
})
```

Additional tests verify:
- Bottom pane estimates never sum above terminal width (line 444–450)
- Done/epic row content fits pane budget at moderate widths (lines 462–484)

### 2. Narrow terminal regression suite reflects equal split constraints ✅

`narrowTerminal.test.ts` uses thresholds derived from `Math.floor(terminalWidth / 2)` half-width budgeting:
- Done row safe from tw=92 (floor(92/2)=46 > DONE_FIXED 45)
- Epic row safe from tw=40 (floor(40/2)=20 > EPIC_FIXED 19)
- Bottom pane sum never exceeds terminal width (sweep 20–80)
- Cross-layer consistency verified across pane, header, and footer layers (sweep 60–160)

### 3. queued_for_deletion rendering covered with deleting label and warning style ✅

`dashboard.test.ts` lines 500–528 contain 6 dedicated assertions:
- `queued_for_deletion` uses warning/orange color `#e0af68`
- `queued_for_deletion` uses loading indicator `◌`
- `queued_for_deletion` displays as `deleting` label
- Color matches `dirty` (both use warning)
- Indicator differs from error indicator `✗`
- Color differs from error color
- All epic statuses have defined color, indicator, and label

### 4. All updated tests pass with no scope creep ✅

```
79 pass, 0 fail, 3080 expect() calls across 2 files [417ms]
```

## Implementation Verified

### DashboardView.tsx

- **Vertical split:** Active region and bottom row both use `flexGrow: 1` (1:1)
- **Horizontal split:** Epic pane and Done pane both use `flexGrow: 1` (1:1)
- **computePaneWidths:** Both panes use `Math.floor(terminalWidth / 2)` — conservative floor-based budgeting
- **Status maps:**
  - `epicStatusColor.queued_for_deletion` = `colors.status.warning` (#e0af68 orange)
  - `epicStatusIndicator.queued_for_deletion` = `"◌"` (loading circle)
  - `epicStatusLabel.queued_for_deletion` = `"deleting"`

## Conclusion

All test contracts are correctly implemented. The tests guard against regression to uneven splits (1:2 bottom, active-weighted vertical) and error-style deletion status. No scope creep outside layout/presentation testing.
