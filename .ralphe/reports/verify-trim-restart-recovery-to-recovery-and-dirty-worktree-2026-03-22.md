# Verification: Trim restartRecovery to recovery and dirty-worktree ownership

**Date:** 2026-03-22
**Status:** PASS

## Summary

The `restartRecovery.test.ts` file has been properly trimmed to own only recovery-specific startup behavior and dirty-worktree pause/resume contracts. All 20 tests pass (49 assertions).

## Test Results

```
bun test apps/ralphe/tests/restartRecovery.test.ts
 20 pass
 0 fail
 49 expect() calls
Ran 20 tests across 1 file. [411.00ms]
```

## Acceptance Criteria Verification

### ✅ restartRecovery keeps coverage for recovery ordering, stale-task recovery semantics, dirty-worktree pause/resume, and combined startup sequencing

The file contains 5 describe blocks covering exactly these areas:

1. **"restart recovery: startup ordering"** (3 tests) — recovery runs before queryQueued, before claimTask, and dirty-check runs between recovery and polling.
2. **"restart recovery: stale-task recovery regardless of workerId"** (3 tests) — recovers tasks from different workers, multiple stale tasks in one startup, recovery count callback.
3. **"restart recovery: recovered issue state is open + error"** (7 tests) — markTaskExhaustedFailure (not close), finishedAt metadata, reopen before error label, assignee cleared, reopen→clearAssignee→markExhausted ordering, no ghost re-pickup, crash reason in message.
4. **"dirty worktree: pauses automatic pickup"** (2 tests) — no claims while dirty, recovery still runs when dirty.
5. **"dirty worktree: clean state allows normal polling"** (3 tests) — clean allows polling, dirty→clean resumes polling, no pause log when already clean.
6. **"restart recovery: combined recovery + dirty-worktree + polling"** (2 tests) — full startup sequence clean path and dirty path.

### ✅ Overlap with general lifecycle coverage is removed

The file header (lines 1-13) explicitly documents that it does NOT re-prove general task lifecycle (claim→execute→close) which is owned by watchWorkflow and watchLifecycle suites.

Three inline comments throughout the test file defer lifecycle concerns:
- Line 601: `(full claim→execute→close lifecycle is owned by watchWorkflow/watchLifecycle)`
- Line 634: `(full claim→execute→close lifecycle is owned by watchWorkflow/watchLifecycle)`
- Line 673: `(claim→execute→close lifecycle ordering is owned by watchWorkflow/watchLifecycle)`

No test in restartRecovery.test.ts asserts on closeTaskSuccess/closeTaskFailure as positive expected outcomes — the only reference is a negative assertion confirming recovered tasks are NOT closed (line 393-401).

Cross-reference with `watchWorkflow.test.ts` (canonical lifecycle) and `watchLifecycle.test.ts` (integration lifecycle) confirms no duplication.

### ✅ Recovery-specific ordering and state-transition assertions remain explicit and easy to identify

Key ordering assertions are present and clearly labeled:
- Recovery before poll: `expect(firstPollIdx).toBeGreaterThan(recoveryIdx)` (line 254)
- Recovery before claim: `expect(firstClaimIdx).toBeGreaterThan(recoveryIdx)` (line 275)
- Dirty-check between recovery and poll: lines 296-297
- Per-issue ordering `reopen → clearAssignee → markExhausted`: lines 481-487
- Full startup sequence ordering: lines 674-686

## Implementation Quality

- Uses local in-memory fakes (not global mocks) for recovery/git/runTask boundaries
- Exercises real `startTuiWorker` and `processClaimedTask` orchestration
- Deterministic fixtures with explicit setup per test
- 5-second waitFor timeouts for CI reliability
- Clean beforeEach reset of all stubs

## Conclusion

The restartRecovery test suite correctly owns recovery and dirty-worktree contracts without re-proving general lifecycle behavior. All acceptance criteria are met.
