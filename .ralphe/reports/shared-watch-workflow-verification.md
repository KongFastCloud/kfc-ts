# Verification Report: Extract Shared Effect Watch-Task Workflow

**Date:** 2026-03-22
**Status:** PASS

## Summary

The shared Effect-native watch-task workflow has been correctly implemented. Both headless watch and TUI watch consume a single canonical workflow module (`watchWorkflow.ts`) for the poll/claim/execute/finalize lifecycle, eliminating duplicated watch-domain logic.

## Acceptance Criteria Verification

### 1. Shared Effect-native watch-task workflow for poll/claim/execute/finalize behavior
**PASS**

- `watchWorkflow.ts` exports two core functions:
  - `pollClaimAndProcess(workDir, workerId)` — single poll-claim-process cycle returning a discriminated union (`NoneReady | ClaimContention | Processed`)
  - `processClaimedTask(issue, config, workerId)` — full task lifecycle: read previous metadata, write start metadata, build prompt (with previous error context), execute via `runTask`, write final metadata, and finalize (close on success, mark exhausted failure on error)
- Both functions are Effect-native (`Effect.Effect<T, FatalError>`) with structured logging annotations (`taskId`, `issueTitle`) and a `"task"` log span.

### 2. Headless watch behavior remains intact
**PASS**

- `watcher.ts` imports `pollClaimAndProcess` from the shared workflow and uses it within its Effect-based poll loop.
- Headless-specific orchestration is preserved: startup recovery via `recoverStaleTasks`, dirty-worktree guard via `isWorktreeDirty`, poll interval with `Effect.sleep`, and optional `maxTasks` limit.
- Logging annotations (`workerId`) and all domain semantics (stale-task handling, contention skipping) are intact.

### 3. Tests verify shared workflow without duplicated implementations
**PASS**

Three test files cover the shared workflow:
- `watchWorkflow.test.ts` (17 tests): Tests `processClaimedTask` and `pollClaimAndProcess` in isolation — success/failure lifecycle, previous error propagation, metadata timing, operation ordering, prompt building.
- `watchLifecycle.test.ts` (23 tests): Integration tests via `startTuiWorker` verifying full lifecycle through the shared workflow — sequential processing, claim contention, metadata ordering, callback behavior, failure recovery, exhausted failures.
- `tuiWorker.test.ts` (5 tests): Tests TUI worker callback contract — stop behavior, timestamps, state transitions, custom workerIds, error resilience.

**All 45 tests pass (159 assertions). Zero failures.**

## Architecture

```
CLI (cli.ts)
├── watch --headless → watcher.ts (Effect loop)
│   └── pollClaimAndProcess() ← shared workflow
└── watch (TUI) → watchTui.tsx → tuiWorker.ts (async loop)
    └── processClaimedTask()  ← shared workflow
```

Both entrypoints delegate core task processing to `watchWorkflow.ts`. Mode-specific orchestration (poll loop style, callbacks, state management) stays in the respective orchestrators.

## Verification Steps

1. Read all implementation files (`watchWorkflow.ts`, `watcher.ts`, `tuiWorker.ts`)
2. Confirmed headless watcher imports `pollClaimAndProcess` from shared workflow
3. Confirmed TUI worker imports `processClaimedTask` from shared workflow
4. Ran all 45 tests across 3 test files — all pass
5. TypeScript compilation passes with zero errors
