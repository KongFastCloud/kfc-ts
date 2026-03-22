# Verification: Remove Done Count from StatsFooter

**Date:** 2026-03-22
**Status:** PASS

## What Was Verified

### 1. StatsFooter renders only durations, no count
The `StatsFooter` component in `DashboardView.tsx` (lines 546-592) renders:
- **Normal state** (line 573-591): `Today: <dur> │ This week: <dur>` — no count segment present
- **Empty state** (line 551-570): `Today: — │ This week: —` — no count segment present

There is no `{week.count} done` text node or preceding `│` separator in either branch.

### 2. Empty state still works correctly
The `week.count === 0` guard (line 551) still gates the empty-state branch, showing em-dash (`—`) placeholders for both durations. The `AggregateTotals.count` field is preserved in `statsCompute.ts` and used solely for this check.

### 3. All tests pass
- **dashboard.test.ts**: 29 tests pass — no assertions reference a "done" count in the footer
- **statsCompute.test.ts**: 28 tests pass — unchanged, `count` field still computed and tested
- **All ralphe tests**: 433 tests pass across 24 files, 0 failures

### 4. No residual "done count" rendering
Grep confirmed no `done` count text rendering remains in the StatsFooter JSX. The only `count` reference in the component is `day.count > 0` (line 587), used to decide between showing a formatted duration or an em-dash for the today segment.

## Acceptance Criteria Checklist
- [x] StatsFooter renders only 'Today: <dur> │ This week: <dur>' with no count
- [x] Empty state still shows dashes for both durations
- [x] Dashboard tests pass with updated assertions
- [x] statsCompute tests remain green (no changes)
