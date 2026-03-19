# Verification Report: Lock Restart Recovery And Dirty-Worktree Guard With Regression Coverage

**Date:** 2026-03-19
**Status:** PASS

## Summary

All 17 regression tests in `restartRecovery.test.ts` pass (46 assertions), covering restart recovery startup ordering, stale-task recovery, recovered issue state, and dirty-worktree guard behavior. Related test suites (`watchLifecycle.test.ts`, `tuiWorker.test.ts`) also pass (25 tests, 82 assertions).

## Acceptance Criteria Verification

### 1. Stale in_progress issues are recovered before any new polling/claiming
**PASS** — Three tests in "restart recovery: startup ordering" verify:
- `recoverStaleTasks` runs before any `queryActionable` poll
- `recoverStaleTasks` runs before any `claimTask` call
- Dirty-worktree check runs after recovery but before polling

### 2. Recovery is not limited to matching previous workerId
**PASS** — Two tests in "stale-task recovery regardless of workerId" verify:
- Orphaned task from "worker-A" is recovered by "worker-B"
- Multiple stale tasks from different workers (A, B, C) are all recovered in a single startup by "worker-current"

### 3. Recovered issues land in expected open + error state
**PASS** — Four tests in "recovered issue state is open + error" verify:
- `markTaskExhaustedFailure` is called (open + error), not `closeTaskFailure` or `closeTaskSuccess`
- Metadata includes `finishedAt` timestamp, `timestamp`, and `engine`
- Recovered tasks do not re-appear as active in subsequent polls
- Recovery reason contains "recovered on startup"

### 4. Dirty worktree state pauses automatic pickup
**PASS** — Two tests in "dirty worktree: pauses automatic pickup" verify:
- No claims or polls occur while worktree is dirty
- Recovery still runs even when worktree is dirty (recovery precedes dirty check)

### 5. Clean worktree state allows normal polling after recovery
**PASS** — Three tests in "dirty worktree: clean state allows normal polling" verify:
- Clean worktree allows full lifecycle: recovery -> dirty-check -> poll -> claim -> execute -> close
- Worktree becoming clean after a dirty pause resumes polling and processes tasks
- No "pausing" log emitted when worktree is already clean

## Test Results

```
bun test v1.3.9 — tests/restartRecovery.test.ts
17 pass, 0 fail, 46 expect() calls [541.00ms]

bun test v1.3.9 — tests/watchLifecycle.test.ts + tests/tuiWorker.test.ts
25 pass, 0 fail, 82 expect() calls [2.50s]
```

## Implementation Details

- **Test file:** `apps/ralphe/tests/restartRecovery.test.ts` (667 lines)
- **Mocking approach:** Bun module mocks matching `watchLifecycle.test.ts` patterns
- **Source files exercised:** `tuiWorker.ts` (startup sequence), `beads.ts` (recovery logic), `git.ts` (dirty worktree check)
- **Test structure:** 5 describe blocks, 17 tests, deterministic assertions on call ordering and state transitions
