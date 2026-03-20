# Verification: Skip dimming on selected done rows for legible contrast

**Date:** 2026-03-20
**Status:** PASS

## What was verified

The implementation in `apps/ralphe/src/tui/DashboardView.tsx` (lines 297-346) correctly overrides dimming for selected done rows.

### Core change

```typescript
const isDimmed = task.status === "done" || task.status === "error"
const effectiveDimmed = isDimmed && !isSelected
```

Line 298 introduces `effectiveDimmed` which is `false` whenever a row is selected, regardless of done/error status. All color computations use `effectiveDimmed` instead of `isDimmed`.

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Selected done row ID uses `fg.muted` (not `fg.dim`) | PASS | Line 320: `effectiveDimmed ? colors.fg.dim : colors.fg.muted` — when selected, effectiveDimmed=false → fg.muted |
| Selected done row title uses `fg.primary` (not `fg.dim`) | PASS | Lines 321-325: effectiveDimmed=false + isSelected=true → fg.primary |
| Selected done row duration uses `status.info` (not `fg.dim`) | PASS | Line 346: `!effectiveDimmed` is true when selected → status.info |
| Unselected done rows retain dimmed appearance | PASS | When isSelected=false + isDimmed=true → effectiveDimmed=true → all columns use fg.dim |
| Active table selected rows unaffected | PASS | Active tasks have isDimmed=false → effectiveDimmed=false regardless of selection; no behavioral change |

## Additional checks

- **TypeScript compilation:** Clean (no errors)
- **No test regressions:** No existing unit tests for DashboardRow; color logic is straightforward conditional
- **Scope:** Change is confined to `effectiveDimmed` variable and its usage in the same function; no other files modified
