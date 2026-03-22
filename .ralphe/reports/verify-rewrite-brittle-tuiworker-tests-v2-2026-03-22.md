# Verification: Rewrite Brittle tuiWorker Tests Around Explicit Fixtures

**Date:** 2026-03-22
**Commit:** 535d96a `test(tuiWorker): rewrite brittle tests with explicit mocks and deterministic fixtures`

## Summary

The tuiWorker test suite was rewritten from 5 tests (198 lines) to 10 tests (411 lines), replacing ambient environment dependencies with explicit configurable stubs for all external boundaries.

## Test Execution

```
bun test v1.3.11
 10 pass
 0 fail
 30 expect() calls
Ran 10 tests across 1 file. [205.00ms]
```

All 10 tests pass deterministically.

## Acceptance Criteria Verification

### ✅ AC1: Tests no longer rely on ambient environment failure paths

**Before:** The old suite only mocked `git` and `beads` — it did NOT mock `beadsAdapter`, `watchWorkflow`, or `config`. Tests that exercised error paths relied on these modules failing naturally (e.g., missing `.beads` DB, unavailable `bd` CLI, filesystem config).

**After:** The new suite explicitly mocks all five external boundaries:
- `git.js` — `isWorktreeDirty` returns `Effect.succeed(false)`
- `beadsAdapter.js` — `queryQueued` is controlled via `readyQueue` and `queryQueuedError` stubs
- `beads.js` — All functions are deterministic no-ops with `claimResult` and `claimTaskError` stubs
- `watchWorkflow.js` — `processClaimedTask` is controlled via `processResult` and `processError` stubs
- `config.js` — `loadConfig` returns deterministic defaults, no filesystem access

Each test calls `resetStubs()` before setting up its specific scenario.

### ✅ AC2: Tests cover only worker-specific unit behavior

The 10 tests cover exactly the worker-unit behaviors specified:

| Test | Behavior Covered |
|------|-----------------|
| interrupt stops the worker and emits 'Worker stopped' log | Interrupt/stop behavior |
| every log entry has a Date timestamp and non-empty message | Log entry shape |
| worker transitions to idle when no tasks are queued | State transitions (idle) |
| worker transitions idle → running → idle when a task is claimed | State transitions (full cycle) |
| custom workerId appears in the starting log message | Worker ID propagation |
| worker survives queryQueued adapter error and returns to idle | Resilience to adapter errors |
| worker survives claimTask failure and returns to idle | Resilience to adapter errors |
| claim contention: worker stays idle when another worker claims first | Claim contention handling |
| onTaskComplete callback fires after a task finishes | Callback wiring |
| onTaskComplete fires for failed tasks too | Callback wiring (failure path) |

No test exercises general lifecycle, shared workflow, or integration behavior — those stay in their respective suites.

### ✅ AC3: Test titles and assertions align

Each test title accurately describes the behavior proven by its assertions:
- "interrupt stops the worker" → asserts `Worker stopped` log exists after `worker.interrupt()`
- "every log entry has a Date timestamp" → iterates all logs verifying `timestamp instanceof Date`
- "worker transitions to idle when no tasks are queued" → asserts idle state present, running state absent
- "worker transitions idle → running → idle" → asserts index ordering of state transitions and `currentTaskId`
- "custom workerId appears" → asserts log message contains the custom ID string
- "worker survives queryQueued adapter error" → injects `queryQueuedError`, asserts error logged and worker still alive
- "worker survives claimTask failure" → injects `claimTaskError`, asserts error logged, no running state, worker alive
- "claim contention" → sets `claimResult = false`, asserts "already claimed" log, no running state
- "onTaskComplete callback fires" → asserts `taskCompletions.length >= 1`
- "onTaskComplete fires for failed tasks too" → sets `processResult.success = false`, asserts callback fires and exhausted log

No test promises stronger guarantees than its assertions prove.

## Key Design Improvements

1. **Configurable stubs** (`readyQueue`, `claimResult`, `queryQueuedError`, etc.) replace ambient failures with explicit scenario setup
2. **`waitFor` helper** with timeout replaces fragile fixed-delay waits
3. **`resetStubs()` + `makeCollectors()`** pattern ensures test isolation
4. **One-shot queue draining** (`readyQueue = []` after first read) prevents infinite task processing loops

## Verdict

**PASS** — All three acceptance criteria are met. The tuiWorker tests are now deterministic, explicitly mocked, and cover only worker-specific unit behavior.
