# Verification Report: Pause Automatic Pickup When Restart Finds Dirty Worktree

**Date:** 2026-03-19
**Status:** PASS

## Summary

The dirty-worktree guard feature is correctly implemented across both execution modes (headless watcher and TUI worker). All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. After startup recovery, Ralphe checks whether the git worktree is dirty before claiming new tasks
**PASS** - Both `watcher.ts` (line 59) and `tuiWorker.ts` (line 107) call `isWorktreeDirty()` after `recoverStaleTasks()` and before entering the polling loop. Test `dirty-worktree check runs after recovery but before polling` confirms ordering: recovery → dirty-check → polling.

### 2. If the worktree is dirty, automatic pickup remains paused and no new task is claimed
**PASS** - Both implementations enter a polling loop that re-checks `isWorktreeDirty()` at the configured interval, blocking entry to the main task-claiming loop. Test `no claims are made while worktree is dirty` confirms no `claimTask` or `queryActionable` calls occur while dirty.

### 3. A clear operator-facing message explains that pickup is paused until the worktree is clean
**PASS** - Both implementations log: `"Worktree has uncommitted changes — pausing automatic pickup."` when dirty, and `"Worktree is clean — resuming automatic pickup."` when cleanup is detected. Tests verify these messages appear in logs.

### 4. The slice does not auto-stash, auto-commit, or auto-discard changes
**PASS** - The `isWorktreeDirty()` function (git.ts:75-78) only runs `git status --porcelain` — a read-only operation. No destructive git commands (stash, commit, checkout, clean) are invoked. The implementation is detection-and-pause only.

### 5. Clean worktrees continue into normal polling after recovery completes
**PASS** - When `isWorktreeDirty()` returns false, both implementations skip the pause loop entirely and proceed to normal polling. Test `clean worktree allows polling to proceed after recovery` confirms the full lifecycle: recovery → dirty-check → poll → claim → execute → close.

## Implementation Details

### Core function (`git.ts`)
- `isWorktreeDirty()`: Runs `git status --porcelain`, returns `true` if output is non-empty.

### Headless watcher (`watcher.ts`)
- Uses `Effect.iterate` to poll `isWorktreeDirty()` at `pollIntervalMs` intervals until clean.

### TUI worker (`tuiWorker.ts`)
- Uses a `while` loop with `sleep()` to poll `isWorktreeDirty()`, also respects the `stopped` flag for clean shutdown.

### Startup ordering (both modes)
1. `recoverStaleTasks(workerId)` — recover any stale in_progress tasks
2. `isWorktreeDirty()` — check worktree cleanliness
3. If dirty: pause loop until clean
4. Normal polling loop begins

## Test Results

- **Test file:** `tests/restartRecovery.test.ts` (666 lines, 17 tests)
- **Result:** 17/17 PASS, 46 assertions
- **Full suite:** 339/339 PASS across 21 files, 0 failures

### Test coverage includes:
- Startup ordering (recovery before dirty-check before polling)
- No claims while dirty
- Recovery runs even when dirty
- Clean worktree proceeds normally
- Worktree becoming clean resumes polling
- No pause log when already clean
- Full combined sequences (recovery + dirty + polling)
