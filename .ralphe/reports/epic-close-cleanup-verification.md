# Verification Report: Epic Close Cleanup and Invalid-Context Failure Handling

**Date:** 2026-03-26
**Status:** PASS

## Summary

All acceptance criteria for the epic close cleanup and invalid-context failure handling feature have been verified. The implementation is correct and all tests pass.

## Acceptance Criteria Verification

### 1. Closing an epic triggers automatic worktree cleanup — PASS
- **Implementation:** `closeEpic()` in `src/beads.ts` (lines 396-419) calls `removeEpicWorktree()` after closing the epic issue in Beads.
- **Evidence:** The function signature accepts an injectable cleanup function (defaults to `removeEpicWorktree`), enabling both real operation and testability.
- **Test coverage:** Contract 1 in `epicCloseCleanup.test.ts` verifies cleanup is triggered on epic close.

### 2. Dirty epic worktrees are still cleaned up, but the system emits or records a warning — PASS
- **Implementation:** `removeEpicWorktree()` in `src/epicWorktree.ts` (lines 276-310):
  - Checks dirty state via `isEpicWorktreeDirty()` before removal
  - Uses `git worktree remove --force` to force-remove even dirty worktrees
  - Emits `Effect.logWarning()` when dirty, with message: "Epic worktree at {path} has uncommitted changes. Proceeding with cleanup — uncommitted work will be discarded."
  - `closeEpic()` also emits a second warning when `cleanupResult.wasDirty` is true
- **Evidence:** `EpicWorktreeCleanupResult` interface carries `wasDirty: boolean` and `worktreePath` for operator visibility.
- **Test coverage:** Contracts 2 and 4 in `epicCloseCleanup.test.ts`.

### 3. Cleanup behavior is immediate and does not introduce a second cleanup lifecycle state machine — PASS
- **Implementation:** `removeEpicWorktree()` is a simple Effect that runs `git worktree remove --force` then `git worktree prune`. No queues, retries, or state transitions.
- **Evidence:** The function is 35 lines of straightforward Effect code. Comment in code explicitly states: "This is a simple immediate operation — no second cleanup-state machine."

### 4. Tasks with incomplete or invalid parent epic runtime context are marked errored explicitly — PASS
- **Implementation:** `processClaimedTask()` in `src/watchWorkflow.ts` calls `loadEpicContext()` and on failure:
  - Logs a warning: "Epic context invalid for task {id}: {reason}"
  - Calls `markTaskExhaustedFailure(id, reason, metadata)` with timing info
  - Returns `{ success: false, error: reason }`
  - No agent execution occurs
- **Error reasons covered:**
  - `EPIC_ERROR_NO_PARENT` — standalone task with no parent
  - `EPIC_ERROR_PARENT_NOT_FOUND(id)` — parent cannot be loaded
  - `EPIC_ERROR_MISSING_LABEL(id)` — parent lacks "epic" label
  - `EPIC_ERROR_EMPTY_BODY(id)` — epic has empty/whitespace-only PRD
  - `EPIC_ERROR_MISSING_BRANCH(id)` — epic has no canonical branch
- **Test coverage:** Contract 6 in `epicCloseCleanup.test.ts` — 5 tests covering each invalid-context variant.

### 5. Invalid epic-context failures are surfaced in an operationally visible way consistent with current task failure handling — PASS
- **Implementation:** Uses the same `markTaskExhaustedFailure()` mechanism as execution failures. This adds error labels, persists failure reason and metadata, keeping the failure visible in the TUI.
- **Evidence:** `isInvalidEpicContextError()` predicate in `src/epic.ts` classifies errors, and test "all invalid-context failures follow the same operational pattern as execution failures" explicitly verifies the same `ProcessTaskResult` shape and `markTaskExhaustedFailure` call.
- **Test coverage:** Contract 5 (predicate) and Contract 6 (operational surfacing) in `epicCloseCleanup.test.ts`.

## Test Results

| Test File | Tests | Pass | Fail |
|---|---|---|---|
| `epicCloseCleanup.test.ts` | 20 | 20 | 0 |
| `epic.test.ts` | 20 | 20 | 0 |
| `epicWorktree.test.ts` | 10 | 10 | 0 |
| `watchWorkflow.test.ts` | 37 | 37 | 0 |
| **Total** | **87** | **87** | **0** |

## Files Reviewed

- `apps/ralphe/src/epic.ts` — Epic domain model, validation, `isInvalidEpicContextError` predicate
- `apps/ralphe/src/epicWorktree.ts` — Worktree lifecycle, dirty detection, `removeEpicWorktree`, `EpicWorktreeCleanupResult`
- `apps/ralphe/src/beads.ts` — `closeEpic()` function with automatic worktree cleanup
- `apps/ralphe/src/watchWorkflow.ts` — `processClaimedTask()` with invalid-context error handling
- `apps/ralphe/tests/epicCloseCleanup.test.ts` — 20 tests across 6 contracts
