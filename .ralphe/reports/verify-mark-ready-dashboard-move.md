# Verification Report: Move mark-ready keybinding from detail view to dashboard view

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Verification

### 1. Pressing m on the dashboard marks the selected eligible task as ready
**PASS** - The `m` key case is in the dashboard branch of the keyboard handler (line 566, inside `switch` after `if (viewMode === "detail")` block). It checks `getAvailableActions(selectedTask).includes("mark-ready")` and calls `markTaskReady(taskId, currentLabels)` via `Effect.runPromise`.

### 2. Pressing m on the dashboard with a done task selected does nothing
**PASS** - The eligibility check `getAvailableActions(selectedTask).includes("mark-ready")` returns false for done tasks (verified in beadsAdapter.ts: `MARK_READY_ELIGIBLE` set excludes `done`). The guard condition prevents the handler from executing.

### 3. Dashboard footer shows m:Mark Ready when selected task is eligible
**PASS** - `WatchFooter` receives `hasMarkReady` prop (line 638-642) computed as `viewMode === "dashboard" && selectedTask != null && getAvailableActions(selectedTask).includes("mark-ready")`. The footer template appends `m:Mark Ready` when `hasMarkReady` is true, only for dashboard mode (line 150).

### 4. Detail view no longer responds to m key
**PASS** - The detail-mode branch (lines 519-528) only handles `escape` and `backspace`, then returns via `default: return`. The `m` key case is unreachable in detail mode.

### 5. Detail footer no longer shows m:Mark Ready hint
**PASS** - The detail footer string (line 149) is hardcoded as `"Esc/Backspace:Back  ^Q:Quit"` with no mark-ready hint. The `hasMarkReady` conditional only applies to the dashboard branch (line 150).

### 6. Task list refreshes after marking ready
**PASS** - After `markTaskReady` resolves, `.then(() => doRefresh())` is called (line 577).

## Additional Checks

- **Concurrency guard:** `markingReadyRef` prevents double-invocation (lines 571, 573, 583).
- **Error handling:** Failures set an error message via `setError` (lines 578-580).
- **TypeScript:** Compiles cleanly (`tsc --noEmit` passes).
- **Tests:** All 364 tests pass across 21 test files.

## Files Reviewed
- `apps/ralphe/src/tui/WatchApp.tsx` - Main implementation file (keyboard handler, footer, detail pane)
- `apps/ralphe/src/beadsAdapter.ts` - `getAvailableActions`, `MARK_READY_ELIGIBLE`
- `apps/ralphe/src/beads.ts` - `markTaskReady` function
