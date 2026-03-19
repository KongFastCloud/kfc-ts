# Verification Report: Recover Stale In-Progress Issues To Open Error On Startup

**Date:** 2026-03-19
**Status:** PASS

## Summary

The feature correctly implements global stale in-progress issue recovery on startup, transitioning interrupted tasks to open + error state before any normal polling begins.

## Acceptance Criteria Verification

### 1. Startup recovery scans all stale in_progress issues, not just those matching the current workerId
**PASS** — `recoverStaleTasks()` in `beads.ts` calls `queryAllStaleInProgress()` which lists ALL `in_progress` issues without workerId filtering. Test "recovers stale tasks from a different worker" confirms tasks from worker-A are recovered by worker-B. Test "recovers multiple stale tasks from different workers in a single startup" confirms 3 tasks from 3 different workers are all recovered.

### 2. Each recovered issue is moved out of in_progress and lands in the intended open + error model
**PASS** — Recovery calls `reopenTask(id)` (sets status to `open`), then `markTaskExhaustedFailure()` which removes the `ready` label and adds the `error` label. Test "recovered tasks use markTaskExhaustedFailure, not closeTaskFailure" confirms the correct function is used and `closeTaskFailure`/`closeTaskSuccess` are NOT called.

### 3. Recovered issues no longer retain ready label or stale assignee/claim residue
**PASS** — `markTaskExhaustedFailure()` removes the `ready` label via `removeLabel(id, "ready")`. `clearAssignee(id)` is called to remove stale claim ownership. Test "recovered tasks have assignee cleared (no stale claim residue)" verifies `clearAssignee` is called. Test "recovery ordering per issue: reopen → clearAssignee → markExhausted" verifies the correct ordering.

### 4. Recovery appends clear interruption context for startup recovery
**PASS** — Recovery metadata includes `finishedAt` timestamp, and `markTaskExhaustedFailure` appends a note "Exhausted failure: worker crashed — recovered on startup". Test "recovered task metadata includes finishedAt timestamp" and "recovery reason mentions crash/startup context" verify this.

### 5. Recovery completes before normal actionable polling begins
**PASS** — Both `watcher.ts` and `tuiWorker.ts` call `recoverStaleTasks()` before entering the poll loop. Tests "recoverStaleTasks runs before any queryActionable poll", "recoverStaleTasks runs before any claimTask call", and "dirty-worktree check runs after recovery but before polling" all verify strict ordering.

## Test Results

- **20/20 tests pass** in `tests/restartRecovery.test.ts`
- **0 errors** from typecheck (`tsc --noEmit`)
- **0 lint errors** (1 unrelated warning in a different test file)

## Key Implementation Files

| File | Role |
|------|------|
| `apps/ralphe/src/beads.ts` | `recoverStaleTasks()`, `queryAllStaleInProgress()`, `reopenTask()`, `clearAssignee()`, `markTaskExhaustedFailure()` |
| `apps/ralphe/src/watcher.ts` | CLI watcher startup: recovery → dirty-check → polling |
| `apps/ralphe/src/tuiWorker.ts` | TUI worker startup: recovery → dirty-check → polling |
| `apps/ralphe/tests/restartRecovery.test.ts` | 20 tests covering all acceptance criteria |

## Recovery Flow

```
startup
  → recoverStaleTasks(workerId)
    → queryAllStaleInProgress()          // ALL in_progress, no workerId filter
    → for each stale issue:
      → reopenTask(id)                   // status → open
      → clearAssignee(id)                // remove stale claim
      → markTaskExhaustedFailure(id)     // remove ready, add error, write metadata with finishedAt, append note
  → isWorktreeDirty() check
  → begin polling loop
```
