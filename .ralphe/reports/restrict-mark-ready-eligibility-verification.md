# Verification Report: Restrict mark-ready eligibility

**Date:** 2026-03-20
**Task:** Restrict mark-ready eligibility to backlog, blocked, and error statuses
**Result:** PASS

## Acceptance Criteria Verification

| Criteria | Status | Evidence |
|----------|--------|----------|
| MARK_READY_ELIGIBLE contains only backlog, blocked, and error | PASS | `beadsAdapter.ts:424-428` defines `Set(["backlog", "blocked", "error"])` |
| Pressing m on a queued task does nothing | PASS | `getAvailableActions` returns `[]` for queued; test at line 506-510 confirms |
| Pressing m on an active task does nothing | PASS | `getAvailableActions` returns `[]` for active; tests at lines 517-527 confirm |
| Pressing m on backlog, blocked, and error tasks still enqueues mark-ready | PASS | Tests at lines 501-532 confirm mark-ready returned for all three statuses |
| getAvailableActions returns empty array for queued, active, and done statuses | PASS | Tests at lines 506-538 verify empty arrays for all three |
| Unit tests updated to cover the new eligibility rules | PASS | 7 test cases in `getAvailableActions` describe block cover all statuses + unknown |

## Implementation Details

### Source: `apps/ralphe/src/beadsAdapter.ts`

- `MARK_READY_ELIGIBLE` is a `ReadonlySet<WatchTaskStatus>` containing exactly `{"backlog", "blocked", "error"}` (line 424-428)
- `getAvailableActions()` checks membership in this set and returns `["mark-ready"]` only for eligible statuses (lines 434-439)
- `queued` and `active` are excluded from the set

### Tests: `apps/ralphe/tests/beadsAdapter.test.ts`

- 7 test cases covering: backlog (eligible), queued (not eligible), blocked (eligible), active (not eligible), active with owner (not eligible), error (eligible), done (not eligible), unknown status (not eligible)

### Test Run

All 388 tests across 22 files passed (0 failures, 918 assertions).

## Conclusion

The implementation correctly restricts mark-ready eligibility to only backlog, blocked, and error statuses. All acceptance criteria are met.
