# Verification: Full-Detail Detail-View Loading and Refresh-Safe Re-Resolution

**Date:** 2026-03-23
**Status:** ✅ PASS

## Summary

Verified that the watch TUI detail pane loads full Beads issue detail (including comments/activity) via a dedicated query path, and that refreshes preserve the selected task context while re-resolving full detail.

## Acceptance Criteria Verification

### ✅ AC1: Entering detail view loads the selected task through the full issue-detail query path

- `queryTaskDetail(id, cwd)` in `beadsAdapter.ts` uses `bd show <id> --json` — the full-detail endpoint
- `queryAllTasks(cwd)` uses `bd list --json --all --limit 0` — the lightweight list endpoint (no comments)
- `fetchTaskDetail(taskId)` in `tuiWatchController.ts` calls `queryTaskDetail` and stores the result in `detailTask`
- `WatchSession.tsx` wires `onFetchTaskDetail` callback to `controller.fetchTaskDetail(taskId)`
- Test: `"fetchTaskDetail loads full detail including comments"` — passes, confirms comments are loaded

### ✅ AC2: The detail pane renders comments/activity when they exist in Beads detail data

- `WatchApp.tsx` lines 374-401: Activity Log section renders `task.comments` with timestamps, authors, and text
- Comments are parsed in `beadsAdapter.ts` lines 352-373 from `BdIssueJson.comments` array
- Comments are sorted chronologically (oldest first)
- `WatchTaskComment` interface: `{ id, author?, text, createdAt }`
- 69 beadsAdapter tests pass, including comment parsing and ordering tests

### ✅ AC3: While detail view remains open, refreshes preserve context and re-resolve full detail

- `tuiWatchController.ts` lines 267-272: `refresh()` checks if `detailTaskId` is set and fires `fetchTaskDetail(detailTaskId)` as a non-blocking side effect
- Test: `"refresh re-fetches detail when detail view is open"` — passes, confirms `detailCallCount >= 2` after refresh
- Test: `"refresh does not fetch detail when no detail view is open"` — passes, confirms no unnecessary calls
- `WatchSession.tsx` is mounted once per TUI session and subscribes to controller state changes via React state, preserving local selection/focus across refreshes

### ✅ AC4: Detail fetch loading and failure states are explicit and deterministic

- `detailLoading` is set to `true` before fetch, `false` after completion or error
- `detailError` is set to a descriptive message on failure (`"Task X not found"` or `"Detail fetch failed: ..."`)
- `WatchApp.tsx` line 287: "Loading full detail…" indicator shown during fetch
- `WatchApp.tsx` lines 291-296: Error indicator with ⚠ prefix shown on failure
- Stale result guard at line 308: if user navigates away before fetch completes, result is discarded
- Tests: `"fetchTaskDetail sets loading state during fetch"`, `"fetchTaskDetail sets error for unknown task"`, `"fetchTaskDetail sets error on fetch failure"`, `"stale detail fetch result is discarded after navigating away"` — all pass

### ✅ AC5: No dashboard comment previews, comment editing, or watch-mode workflow changes

- `DashboardView.tsx` has no comment data or rendering
- `queryAllTasks` uses `bd list` (no comments in response)
- No comment creation/editing UI exists in the detail pane
- Worker orchestration (`tuiWorker.ts`, `watchWorkflow.ts`) is unchanged

## Test Results

- **Controller tests:** 23 pass, 0 fail (58 assertions)
- **Beads adapter tests:** 69 pass, 0 fail (111 assertions)
- **Selection preservation tests:** 31 pass, 0 fail (94 assertions)
- **Full suite:** 491 pass, 0 fail (1117 assertions) across 25 files

## Architecture Verification

| Concern | Query Path | Data |
|---------|-----------|------|
| Dashboard list | `bd list --json --all --limit 0` | Lightweight, no comments |
| Detail view | `bd show <id> --json` | Full detail with comments |

The architectural boundary between dashboard (list data) and detail view (full data) is clearly maintained.

## Key Files

- `apps/ralphe/src/tuiWatchController.ts` — Controller with `fetchTaskDetail`, `exitDetailView`, refresh re-resolution
- `apps/ralphe/src/beadsAdapter.ts` — `queryAllTasks` vs `queryTaskDetail`, comment parsing
- `apps/ralphe/src/tui/WatchApp.tsx` — Detail pane with Activity Log rendering, loading/error indicators
- `apps/ralphe/src/tui/WatchSession.tsx` — Single-mount session boundary preserving state across refreshes
- `apps/ralphe/tests/tuiWatchController.test.ts` — 7 detail-view specific tests
- `apps/ralphe/tests/beadsAdapter.test.ts` — Comment parsing and ordering tests
