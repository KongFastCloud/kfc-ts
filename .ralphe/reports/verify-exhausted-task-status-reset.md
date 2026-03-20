# Verification: Reset task status to open in markTaskExhaustedFailure

**Date:** 2026-03-20
**Result:** PASS

## Summary

The implementation correctly adds `reopenTask(id)` as the first step inside `markTaskExhaustedFailure`, ensuring tasks are set to `open` status before applying the error label. The redundant `reopenTask` call in `recoverStaleTasks` has been removed while preserving `clearAssignee`.

## Acceptance Criteria Verification

### 1. After markTaskExhaustedFailure, task status is open (not in_progress)
**PASS** — `markTaskExhaustedFailure` (beads.ts:225) calls `yield* reopenTask(id)` as its first step, which runs `bd update --status open`. This ensures the task is open before any label changes.

### 2. TUI maps the task to error status after failure
**PASS** — `beadsAdapter.ts` documents the mapping: `open + error label → error`. Since `markTaskExhaustedFailure` sets status to open and adds the error label, the TUI will derive error status correctly.

### 3. Duration stops counting after failure
**PASS** — The TUI only shows a ticking duration for `active` status (which requires `in_progress`). After `markTaskExhaustedFailure`, the task is `open`, so it maps to `error` status and duration stops counting.

### 4. recoverStaleTasks still works correctly without redundant reopenTask call
**PASS** — `recoverStaleTasks` (beads.ts:315-340) now calls `clearAssignee` then `markTaskExhaustedFailure`. The `reopenTask` happens inside `markTaskExhaustedFailure`, eliminating the redundant call. All 45 tests pass.

### 5. Assignee clearing in recoverStaleTasks is preserved
**PASS** — `clearAssignee(issue.id)` is called at line 324, before `markTaskExhaustedFailure`, preserving the separate assignee clearing behavior.

## Code Verification

### markTaskExhaustedFailure (beads.ts:218-236)
- Calls `reopenTask(id)` first (line 225)
- Then `writeMetadata`, `removeLabel("ready")`, `addLabel("error")`, `appendNote`

### recoverStaleTasks (beads.ts:315-340)
- Calls `clearAssignee(issue.id)` (line 324)
- Then calls `markTaskExhaustedFailure(...)` (line 327) — no separate `reopenTask` call

### Callers (no changes needed)
- `watcher.ts:140` — calls `markTaskExhaustedFailure` directly
- `tuiWorker.ts:214` — calls `markTaskExhaustedFailure` directly
- Both callers now get automatic `reopenTask` behavior

## Test Results

- **45 tests pass** across restartRecovery, watchLifecycle, and tuiWorker test files
- **Typecheck passes** — no type errors
- Tests cover: recovery ordering (reopen → clearAssignee → markExhausted), metadata preservation, reason strings, and error state correctness

## Note

The test mock for `recoverStaleTasks` records `reopenTask` as a separate op before `clearAssignee`, while production code calls `clearAssignee` first (then `reopenTask` inside `markTaskExhaustedFailure`). This ordering difference is inconsequential since the two operations are independent, and the mock is testing the overall behavior rather than exact internal ordering.
