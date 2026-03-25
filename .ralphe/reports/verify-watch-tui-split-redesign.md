# Verification Report: Watch TUI Split Task and Epic Operations Redesign

**Date:** 2026-03-26
**Status:** PASS

## Summary

The watch TUI has been successfully redesigned to a split model with a global task pane (primary) and a secondary focusable epic pane. All 7 acceptance criteria are satisfied. All 201 unit tests pass across 6 test files.

## Acceptance Criteria Verification

### 1. Split view with global task pane and secondary focusable epic pane — PASS

- **DashboardView.tsx** renders three panes: Active Tasks (top), Done Tasks (middle), Epic Pane (bottom).
- **FocusedTable** type is `"active" | "done" | "epic"` (DashboardView.tsx:691).
- Tab key cycles focus through `active → done → epic → active` (dashboardFocus.ts:101, WatchApp.tsx:702-703).
- Epic pane is independently navigable with up/down keys (dashboardFocus.ts:138-144, 172-181).

### 2. Task pane remains the primary operational pane showing all tasks globally — PASS

- Active tasks pane is the default focused pane on startup (dashboardFocus.ts:44: `focusedTable: "active"`).
- `excludeEpicTasks()` filters epic-labeled tasks from task pane — tasks appear in task pane, epics in epic pane (epicStatus.ts:138-139).
- Task pane supports detail drill-down (Enter key), mark-ready (m key). Epic pane explicitly blocks detail view (dashboardFocus.ts:195).

### 3. Epic pane shows epic ID, title, and one derived status only — PASS

- **EpicDisplayItem** interface: `{ id: string, title: string, status: EpicDisplayStatus }` (epicStatus.ts:44-51).
- **EpicRow** component renders ID, Title, and Status columns (DashboardView.tsx:500-544).
- **EpicTableHeader** shows "ID", "Title", "Status" column headers (DashboardView.tsx:475-497).
- No additional fields are displayed — the pane is operational, not descriptive.

### 4. Required epic statuses not_started, dirty, and queued_for_deletion are derived and displayed correctly — PASS

- **EpicDisplayStatus** type: `"not_started" | "active" | "dirty" | "queued_for_deletion"` (epicStatus.ts:35-39).
- Derivation logic in `deriveEpicDisplayStatus()` (epicStatus.ts:73-89):
  - If in deletion queue → `queued_for_deletion` (highest priority)
  - If worktree dirty → `dirty`
  - If no worktree → `not_started`
  - If worktree clean → `active`
- Color coding: not_started=muted, active=blue, dirty=yellow, queued_for_deletion=red (DashboardView.tsx:57-62).
- Status indicators: `·` (not_started), `●` (active), `△` (dirty), `✗` (queued_for_deletion) (DashboardView.tsx:64-69).
- 150 tests pass for epicStatus, dashboardFocus, and dashboard test suites confirming correct derivation.

### 5. Task-ready and epic-delete actions use separate keys — PASS

- **`m` key**: Mark Ready — available only on task panes (active/done), requires task in backlog/blocked/error status (WatchApp.tsx:745-755).
- **`d` key**: Delete Epic — available only on epic pane (WatchApp.tsx:757-768).
- Keys are distinct and context-guarded: `m` is a no-op on epic pane, `d` is a no-op on task panes.

### 6. Epic deletion queueing is immediate and does not require confirmation — PASS

- `d` key press immediately calls `onEnqueueEpicDelete(selectedEpic.id)` with no confirmation dialog (WatchApp.tsx:764-766).
- Controller's `enqueueEpicDelete()` is non-blocking and synchronous — immediately adds to Effect-native queue and updates `epicDeletePendingIds` state.
- Guard condition only checks that epic is not already `queued_for_deletion` (WatchApp.tsx:763).

### 7. Closed epics queued for deletion remain visible until cleanup completes, then disappear — PASS

- `deriveEpicDisplayItems()` includes closed epics queued for deletion: `task.status === "done" && deletionQueuedIds.has(task.id)` (epicStatus.ts:115).
- Excludes closed epics NOT queued for deletion (epicStatus.ts:117).
- After cleanup completes (worktree removed, issue closed), epic is removed from deletion queue, and next refresh excludes it.
- 51 tests pass for epicWorktree, epicCloseCleanup, and tuiWatchController suites confirming lifecycle.

## Test Results

```
epicStatus.test.ts + dashboardFocus.test.ts + dashboard.test.ts:
  150 pass, 0 fail, 405 expect() calls

epicWorktree.test.ts + epicCloseCleanup.test.ts + tuiWatchController.test.ts:
  51 pass, 0 fail, 128 expect() calls

Total: 201 tests pass, 0 failures
```

## Key Files Reviewed

| File | Purpose |
|------|---------|
| `src/tui/DashboardView.tsx` | Split layout with three panes (active, done, epic) |
| `src/tui/WatchApp.tsx` | Keyboard handling with separate m/d keys |
| `src/tui/dashboardFocus.ts` | Pure focus/selection state with three-pane cycling |
| `src/tui/epicStatus.ts` | Epic status derivation (not_started, active, dirty, queued_for_deletion) |
| `src/tuiWatchController.ts` | Controller with separate mark-ready and epic-delete queues |
| `src/epicWorktree.ts` | Worktree lifecycle management |
| `src/beads.ts` | closeEpic() for cleanup |

## Conclusion

All acceptance criteria are met. The implementation correctly separates task and epic operations, maintains task-first workflow, derives epic statuses from worktree and queue state, uses distinct keybindings, and handles the epic deletion lifecycle including visibility during cleanup.
