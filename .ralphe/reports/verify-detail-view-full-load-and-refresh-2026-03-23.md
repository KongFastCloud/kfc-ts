# Verification: Full-detail detail-view loading and refresh-safe re-resolution

**Date:** 2026-03-23
**Feature:** Detail view loads full Beads issue, renders comments, preserves context across refreshes
**PRD:** `/prd/ralphe-detail-view-comments.md`
**Result:** ✅ PASS

---

## Acceptance Criteria Verification

### 1. ✅ Entering detail view loads the selected task through the full issue-detail query path

**Evidence:**
- `tuiWatchController.ts` — `fetchTaskDetail(taskId)` calls `deps.queryTaskDetail(taskId, workDir)` which invokes `bd show <id> --json` (the full detail query), distinct from `queryAllTasks` which uses `bd list --json --all --limit 0` (the lightweight list query).
- `WatchApp.tsx` — On Enter key press (line 694), `onFetchTaskDetail(taskToDetail.id)` is called before transitioning to detail view mode.
- `WatchSession.tsx` — Wires `onFetchTaskDetail` callback to `controller.fetchTaskDetail(taskId)`.
- **Test:** `"fetchTaskDetail loads full detail including comments"` — confirms the full detail path returns comments, validating it uses `bd show` rather than the list endpoint.

### 2. ✅ The detail pane renders comments/activity when they exist in Beads detail data

**Evidence:**
- `WatchApp.tsx` (lines 374–401) — `DetailPane` renders an "Activity Log" section when `task.comments` is present and non-empty, displaying each comment with timestamp, author, and text.
- `beadsAdapter.ts` (lines 352–373) — Comments are parsed from `bd show --json` output, filtered for valid shape, sorted chronologically (oldest first).
- `WatchTask` type includes `comments?: WatchTaskComment[]` field.
- **Test:** `"fetchTaskDetail loads full detail including comments"` — asserts `detailTask.comments` has length 1 and the comment text matches.

### 3. ✅ While detail view remains open, refreshes preserve the selected task context and re-resolve full detail

**Evidence:**
- `tuiWatchController.ts` (lines 267–273) — Inside `refresh()`, after updating `latestTasks`, the controller checks `if (detailTaskId)` and fires `controller.fetchTaskDetail(detailTaskId)` to re-resolve the currently viewed task's full detail.
- The re-fetch is fire-and-forget (non-blocking on the refresh path), and failures are captured in `detailError` state rather than breaking the refresh flow.
- **Test:** `"refresh re-fetches detail when detail view is open"` — confirms `detailCallCount >= 2` after a refresh while detail view is active.
- **Test:** `"refresh does not fetch detail when no detail view is open"` — confirms `detailCallCount === 0` when no detail view is active.

### 4. ✅ Detail fetch loading and failure states are explicit and deterministic

**Evidence:**
- `tuiWatchController.ts` — `fetchTaskDetail()` sets `detailLoading = true` and `detailError = undefined` before the fetch, then sets `detailLoading = false` and either clears or populates `detailError` after completion/failure.
- Error for not-found: `"Task ${taskId} not found"` (line 311)
- Error for fetch failure: `"Detail fetch failed: ${msg}"` (line 317)
- `WatchApp.tsx` — `DetailPane` renders loading indicator (`"Loading full detail…"`) and error indicator (`"⚠ ${error}"`) explicitly.
- **Tests:**
  - `"fetchTaskDetail sets loading state during fetch"` — captures loading=true during fetch
  - `"fetchTaskDetail sets error for unknown task"` — asserts `detailError` contains "not found"
  - `"fetchTaskDetail sets error on fetch failure"` — asserts `detailError` contains "Detail fetch failed" and the error message
  - `"stale detail fetch result is discarded after navigating away"` — guards against race conditions when exiting detail view during an in-flight fetch

### 5. ✅ No dashboard comment previews, comment editing, or watch-mode workflow changes

**Evidence:**
- `DashboardView.tsx` — unchanged; no comment data referenced.
- `queryAllTasks` — still uses `bd list --json --all --limit 0` (list-oriented query), no comment parsing in the list path.
- No `addComment` calls added to the TUI layer; comment authoring remains in `runTask.ts` only.
- No changes to `watcher.ts`, `watchWorkflow.ts`, or polling/orchestration code.

---

## Implementation Architecture

| Concern | Path | Query |
|---------|------|-------|
| Dashboard list | `queryAllTasks` → `bd list --json --all --limit 0` | Lightweight, no comments |
| Detail view | `queryTaskDetail` → `bd show <id> --json` | Full issue with comments |

The architectural boundary (dashboard=list, detail=full) is cleanly maintained.

## Additional Safeguards

- **Stale fetch guard:** `fetchTaskDetail` checks `detailTaskId !== taskId` before applying results, preventing stale data from a previous navigation.
- **Exit clears state:** `exitDetailView()` zeroes all detail state fields.
- **Reconciliation:** Detail pane renders `detailTaskProp ?? selectedTask` (line 751), showing list data immediately while the full detail loads.

## Test Coverage Summary

- 23 controller tests pass (including 8 detail-view-specific tests)
- 69 beads adapter tests pass (including comment parsing/ordering)
- 491 total tests pass across 25 files
- TypeScript type-check passes with no errors
