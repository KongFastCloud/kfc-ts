# Verification: Epic status UI — render queued_for_deletion as orange deleting state

**Date:** 2026-03-27
**Ticket:** Epic status UI: render queued for deletion as orange deleting state
**Parent epic:** kfc-ts-2k8t

## Result: ✅ PASS

All acceptance criteria for this ticket are met.

## Acceptance Criteria Verification

### 1. ✅ queued_for_deletion displays as orange warning state in epic table
- **File:** `apps/ralphe/src/tui/DashboardView.tsx`, line 71
- **Code:** `queued_for_deletion: colors.status.warning`
- Previously used `colors.status.error` (red); now uses warning (orange).

### 2. ✅ queued_for_deletion uses loading style indicator and label "deleting"
- **Indicator:** Line 79 — `queued_for_deletion: "◌"` (same loading glyph style as mark-ready)
- **Label:** Line 539 — `const statusLabel = epic.status === "queued_for_deletion" ? "deleting" : epic.status`
- The rendered status text shows `◌ deleting` instead of the previous error-styled `✗ queued_for_deletion`.

### 3. ✅ Internal status enum values and queueing behavior remain unchanged
- `EpicDisplayStatus` type still includes `queued_for_deletion` as a variant.
- `epicStatusColor` and `epicStatusIndicator` maps still key on `queued_for_deletion`.
- `deriveEpicDisplayStatus()` in `epicStatus.ts` unchanged — priority order preserved.
- No changes to delete queue consumer or controller logic.

### 4. ✅ No changes to epic deletion command flow
- WatchApp keyboard handling and delete-epic queueing logic untouched.
- Only DashboardView presentation maps were modified.

## Test Results

All 95 tests pass across 3 test files with 3,081 expect() calls:
- `apps/ralphe/tests/dashboard.test.ts` — ✅
- `apps/ralphe/tests/narrowTerminal.test.ts` — ✅
- `apps/ralphe/tests/epicStatus.test.ts` — ✅

## Note on Parent Epic Layout Changes

The parent epic also describes layout split ratio changes (50:50 vertical and horizontal). These are **not part of this specific ticket** and remain in the previous state:
- Active flexGrow: 2, bottom row flexGrow: 1 (not yet 1:1)
- Epic flexGrow: 1, Done flexGrow: 2 (not yet 1:1)
- `computePaneWidths` still uses 1/3 vs 2/3 math (not yet 1/2 vs 1/2)

These are expected to be addressed by separate tickets under the same epic.
