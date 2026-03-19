# Verification Report: Replace Watch Landing Screen With Two-Table Dashboard

**Date:** 2026-03-19
**Status:** ✅ PASS

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `apps/ralphe/src/tui/DashboardView.tsx` | NEW | Dashboard landing view with two stacked tables |
| `apps/ralphe/src/tui/WatchApp.tsx` | MODIFIED | Integrates DashboardView as main landing surface |
| `apps/ralphe/tests/dashboard.test.ts` | NEW | Unit tests for partitionTasks logic |

## Acceptance Criteria Verification

### ✅ The watch TUI opens on a dashboard instead of the current split-pane landing screen
- `WatchApp.tsx` renders `<DashboardView>` as the main content area (line 595).
- The old `TaskRow` / `TaskListPanel` split-pane components have been removed.
- The `DetailPane` component is retained but not rendered on the landing screen.

### ✅ The dashboard renders a top table containing only backlog, actionable, blocked, active, and error tasks
- `partitionTasks()` in `DashboardView.tsx` filters tasks using `NON_DONE_STATUSES` set containing exactly: `backlog`, `actionable`, `blocked`, `active`, `error`.
- The top `DashboardTable` component renders only the `active` partition (non-done tasks).

### ✅ The dashboard renders a bottom table containing only done tasks
- `partitionTasks()` routes tasks with `status === "done"` to the `done` bucket.
- The bottom `DashboardTable` component renders only the `done` partition.

### ✅ Both tables show ID, clipped Title, Status, Label, Priority, and Duration columns
- `DashboardTableHeader` renders: ID (10), Title (dynamic), Status (12), Label (14), Pri (5), Duration (10).
- `DashboardRow` renders all six columns for each task.
- Title is clipped via `truncate()`. Duration renders placeholder "—" until timing metadata is implemented.

### ✅ Done tasks never appear in the top table even when the bottom table is empty
- `partitionTasks()` strictly routes `done` status to the done bucket — there is no fallback.
- Unit test "never places done tasks in the active bucket" exhaustively verifies all statuses.
- Unit test "puts done tasks only in the done bucket" confirms done tasks with empty active bucket.

## Test Results

```
All tests pass:
- dashboard.test.ts: 6/6 pass (partitionTasks logic)
- Full suite: 151/151 pass across 16 files
```

## TypeScript Compilation

```
tsc --noEmit: Clean (no errors)
```

## Design Notes

- Ordering is preserved from the adapter/query layer — no new sorting introduced.
- Selection spans both tables seamlessly (keyboard navigation crosses table boundary).
- Duration column exists with placeholder value "—" as specified.
- Detail view retained but not rendered on dashboard landing (future slice).
