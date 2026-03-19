# Verification Report: Detail-View Mark Ready Action For Non-Done Issues

**Date:** 2026-03-19
**Status:** PASS

## Summary

The Mark Ready action for non-done issues in the Ralphe watch TUI detail view has been correctly implemented. All acceptance criteria are met.

## Verification Steps

### 1. TypeScript Compilation
- `tsc --noEmit` passes with zero errors.

### 2. Test Suite
- All 60 tests in `tests/beadsAdapter.test.ts` pass (0 failures).
- Test coverage includes action availability, label replacement behavior, error-to-ready recovery, and blocked/in-progress status outcomes.

### 3. Code Review — Acceptance Criteria

| Criteria | Status | Evidence |
|----------|--------|----------|
| Non-done issue in detail view exposes Mark Ready action; `m` key triggers it | PASS | `getAvailableActions()` returns `["mark-ready"]` for backlog, actionable, blocked, active, error statuses. `WatchApp.tsx` handles `case "m"` in detail view, gated by `getAvailableActions` check. Footer shows `m:Mark Ready` hint when action is available. |
| Invoking Mark Ready removes all existing labels and leaves exactly the ready label | PASS | `markTaskReady()` in `beads.ts` iterates all `currentLabels`, calls `removeLabel()` for each, then calls `addLabel(id, "ready")`. |
| Error-labeled open issue can be switched back to ready | PASS | Test `"error issue relabeled to ready derives to actionable (no blockers)"` verifies this. Error status is in `MARK_READY_ELIGIBLE` set. |
| Blocked issue marked ready still derives to blocked until dependencies resolve | PASS | Test `"blocked issue relabeled to ready still derives to blocked"` with unresolved dependency confirms status remains `blocked`. |
| Done issue does not expose the action | PASS | Test `"done tasks do not expose mark-ready action"` confirms `getAvailableActions` returns `[]` for done tasks. `done` is not in `MARK_READY_ELIGIBLE` set. |
| Detail view refreshes after mutation | PASS | After successful `markTaskReady()`, `.then(() => doRefresh())` is called, triggering a full data reload. |

### 4. Implementation Quality

- **Concurrency guard**: `markingReadyRef` prevents double-invocation while mutation is in flight.
- **Error handling**: Catch block sets UI error message on failure.
- **Scope**: Implementation is narrowly scoped — no changes to lifecycle state, dependency semantics, retry policy, or dashboard behavior.
- **No non-goals violated**: No bulk actions, no label preservation, no separate clear-error action.

## Files Reviewed

- `apps/ralphe/src/beads.ts` (lines 199-210) — `markTaskReady` mutation helper
- `apps/ralphe/src/beadsAdapter.ts` (lines 360-382) — `TaskAction` type, `MARK_READY_ELIGIBLE`, `getAvailableActions()`
- `apps/ralphe/src/tui/WatchApp.tsx` — `m` key handler (lines 516-536), footer hint (lines 146-149), footer prop (lines 621-627)
- `apps/ralphe/tests/beadsAdapter.test.ts` (lines 493-600) — 8 action-availability tests + 5 status-outcome tests

## Conclusion

All acceptance criteria are satisfied. The implementation is correct, well-tested, and properly scoped.
