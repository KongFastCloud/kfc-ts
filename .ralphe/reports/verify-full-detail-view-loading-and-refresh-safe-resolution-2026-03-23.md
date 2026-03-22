# Verification: Full-Detail Detail-View Loading and Refresh-Safe Re-Resolution

**Date:** 2026-03-23
**Status:** ✅ PASS

## Summary

Verified that the watch TUI detail pane loads the full selected Beads issue via `queryTaskDetail` (bd show --json) rather than relying on the dashboard list snapshot, and that refreshes preserve the current detail context and re-resolve the full detail for the same task.

## Acceptance Criteria Verification

### ✅ AC1: Entering detail view loads the selected task through the full issue-detail query path

- **WatchApp.tsx (line 688-698):** When user presses Enter, `onFetchTaskDetail(taskToDetail.id)` is called, which delegates through WatchSession to `controller.fetchTaskDetail(taskId)`.
- **tuiWatchController.ts (line 300-319):** `fetchTaskDetail` calls `deps.queryTaskDetail(taskId, workDir)` which runs `bd show <id> --json` — a distinct query path from the list query (`bd list --json --all --limit 0`).
- **beadsAdapter.ts (line 444-454):** `queryTaskDetail` is implemented as a separate function that runs `bd show <id> --json` and parses the full result including comments.
- **Test coverage:** `tuiWatchController.test.ts` line 393-408 — "fetchTaskDetail loads full detail including comments" verifies the full path and asserts comments are present.

### ✅ AC2: The detail pane renders comments/activity when they exist in Beads detail data

- **WatchApp.tsx (lines 374-401):** The `DetailPane` component renders an "Activity Log" section when `task.comments` exists and has entries. Each comment shows timestamp, optional author, and text.
- **beadsAdapter.ts (lines 352-373):** Comments are parsed from the `comments` array in bd show JSON output, mapped to `WatchTaskComment` type, and sorted chronologically (oldest first).
- **WatchTask type (line 79):** `comments?: WatchTaskComment[] | undefined` field is defined on the task model.
- **Test coverage:** `beadsAdapter.test.ts` covers comment parsing and ordering.

### ✅ AC3: While detail view remains open, refreshes preserve the selected task context and re-resolve full detail

- **tuiWatchController.ts (lines 267-272):** In `refresh()`, after updating `latestTasks`, if `detailTaskId` is set, it fires `fetchTaskDetail(detailTaskId)` to re-resolve the full detail.
- **WatchSession.tsx:** Single-mount boundary preserves React local state (selection, scroll, viewMode) across controller-driven updates. Controller state changes flow through `onStateChange` → `setControllerState` → React reconciliation.
- **Test coverage:**
  - `tuiWatchController.test.ts` line 479-501 — "refresh re-fetches detail when detail view is open" verifies `detailCallCount >= 2` after entering detail and refreshing.
  - `tuiWatchController.test.ts` line 503-520 — "refresh does not fetch detail when no detail view is open" verifies no spurious detail fetches.
  - `tuiWatchController.test.ts` line 522-552 — "stale detail fetch result is discarded after navigating away" verifies race condition safety.

### ✅ AC4: Detail fetch loading and failure states are explicit and deterministic

- **tuiWatchController.ts (lines 300-319):**
  - `detailLoading = true` set immediately on fetch start, `detailLoading = false` set on success or failure.
  - `detailError` set to specific messages: `"Task ${taskId} not found"` or `"Detail fetch failed: ${msg}"`.
  - Guard `if (detailTaskId !== taskId) return` prevents stale results from overwriting state.
- **WatchApp.tsx (lines 285-296):** DetailPane renders explicit "Loading full detail…" indicator and "⚠ {error}" message.
- **Test coverage:**
  - Line 410-430 — "sets loading state during fetch"
  - Line 432-443 — "sets error for unknown task" (not found)
  - Line 445-460 — "sets error on fetch failure" (network error)

### ✅ AC5: No dashboard comment previews, comment editing, or watch-mode workflow changes

- Comments are only rendered in the `DetailPane` component, not in `DashboardView`.
- No comment creation or editing UI exists.
- No changes to `tuiWorker.ts` or watch-mode orchestration in the relevant commit.

## Test Results

- **491 tests pass, 0 failures** across 25 test files
- **TypeScript compilation:** Clean, no errors
- **Detail-specific tests:** 8 dedicated tests in the "detail view" describe block all pass

## Architecture Verification

| Concern | Implementation |
|---------|---------------|
| Dashboard list query | `queryAllTasks` → `bd list --json --all --limit 0` |
| Detail query | `queryTaskDetail` → `bd show <id> --json` |
| Comment parsing | `bdIssueToWatchTask` — sorted chronologically |
| State ownership | Controller owns `detailTask`, `detailLoading`, `detailError`, `detailTaskId` |
| UI binding | WatchSession subscribes to controller state, passes to WatchApp props |
| Refresh re-resolution | `refresh()` fires `fetchTaskDetail(detailTaskId)` when detail view open |
| Race condition safety | Guard check `detailTaskId !== taskId` before applying result |

## Conclusion

All five acceptance criteria are met. The implementation correctly separates the dashboard list path from the detail query path, loads full issue detail (including comments) when entering detail view, preserves context across refreshes, and exposes deterministic loading/error states. No out-of-scope changes were introduced.
