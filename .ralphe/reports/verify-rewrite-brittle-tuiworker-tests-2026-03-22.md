# Verification: Rewrite Brittle tuiWorker Tests Around Explicit Fixtures

**Date:** 2026-03-22
**Status:** PASS

## Test Execution

All tuiWorker tests pass:
```
bun test v1.3.11
 8 pass
 0 fail
 25 expect() calls
Ran 8 tests across 1 file. [1.81s]
```

## Acceptance Criteria Verification

### AC1: tuiWorker tests no longer rely on ambient environment failure paths
**PASS**

- All external boundaries are explicitly mocked in `beforeAll`: `git.js`, `beadsAdapter.js`, `beads.js`, `watchWorkflow.js`
- Configurable stubs (`readyQueue`, `claimResult`, `queryQueuedError`, `claimTaskError`) give each test deterministic control over adapter behavior
- Git history confirms the old version had a comment: *"The worker will fail on queryReady (no bd CLI available in test) but should not crash"* — this ambient dependency is now replaced with explicit `queryQueuedError` injection
- No references to `.beads` database, `bd` CLI, or environment variables remain
- File header explicitly documents the mock-only approach

### AC2: Remaining tests cover only worker-specific unit behavior
**PASS**

Tests cover exactly the worker-unit behaviors specified:

| Test | Behavior Category |
|------|------------------|
| "interrupt stops the worker and emits 'Worker stopped' log" | Interrupt/stop behavior |
| "every log entry has a Date timestamp and non-empty message" | Log entry shape |
| "worker transitions to idle when no tasks are queued" | State transitions (idle) |
| "worker transitions idle → running → idle when a task is claimed" | State transitions (full cycle) |
| "custom workerId appears in the starting log message" | Worker ID propagation |
| "worker survives queryQueued adapter error and returns to idle" | Resilience to adapter errors |
| "worker survives claimTask failure and returns to idle" | Resilience to adapter errors |
| "onTaskComplete callback fires after a task finishes" | Callback wiring |

No tests re-prove shared workflow lifecycle behavior (task success/failure details, metadata writes, etc.) — those concerns are delegated to the shared workflow suite per the PRD.

### AC3: Test titles and assertions align
**PASS**

Each test's assertions directly prove the claim in its title:

- **"interrupt stops the worker..."** → asserts `Worker starting` log, `Worker stopped` log after `interrupt()`
- **"every log entry has a Date timestamp..."** → iterates all logs, checks `timestamp instanceof Date` and `message.length > 0`
- **"worker transitions to idle..."** → asserts `idle` state exists, `running` state absent (no tasks)
- **"worker transitions idle → running → idle..."** → checks `running` index, verifies `currentTaskId` on running state, checks `idle` appears after running
- **"custom workerId appears..."** → finds log containing `"custom-worker-42"`
- **"worker survives queryQueued adapter error..."** → injects error, checks error logged, last state is idle, Worker stopped emitted
- **"worker survives claimTask failure..."** → injects error, checks error logged, no `running` state, Worker stopped emitted
- **"onTaskComplete callback fires..."** → checks `taskCompletions.length >= 1`

No test title promises more than its assertions prove.

## Design Quality

- **Explicit fixtures**: `resetStubs()` called at the top of every test ensures isolation
- **One-shot queue**: `readyQueue` empties after first read, preventing unintended re-processing
- **Fiber-based lifecycle**: `runWorker` helper mirrors the real controller's fiber management pattern
- **No-op logger layer**: `TestLayer` suppresses Effect logger output without suppressing worker callbacks
- **Clean teardown**: `afterAll` calls `mock.restore()`

## Conclusion

The tuiWorker test suite has been successfully rewritten with explicit mocks replacing all ambient environment dependencies. The suite is small (7 test cases), deterministic, and focused exclusively on worker-unit behavior. All acceptance criteria are met.
