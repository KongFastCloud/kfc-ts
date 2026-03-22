# Verification: Rewrite brittle tuiWorker tests around explicit fixtures

**Date:** 2026-03-22
**Status:** ✅ PASS

## Summary

The tuiWorker test suite has been rewritten with explicit mocks/fixtures replacing all ambient environment dependencies. All 12 tests pass deterministically.

## Test Results

```
bun test v1.3.11
 12 pass
 0 fail
 37 expect() calls
Ran 12 tests across 1 file. [211.00ms]
```

## Acceptance Criteria Verification

### ✅ AC1: No ambient environment failure paths
All external boundaries are explicitly mocked at the module level:
- **git.js** → `isWorktreeDirty` returns `Effect.succeed(false)`
- **beadsAdapter.js** → `queryQueued` controlled via `readyQueue` and `queryQueuedError` stubs
- **beads.js** → All functions (`claimTask`, `closeTaskSuccess`, `closeTaskFailure`, etc.) return deterministic `Effect.succeed` or configurable failures
- **watchWorkflow.js** → `processClaimedTask` controlled via `processResult` and `processError` stubs
- **config.js** → `loadConfig` returns hardcoded defaults, no filesystem access

No test relies on missing tools, unavailable CLI, or filesystem state.

### ✅ AC2: Tests cover only worker-specific unit behavior
The 12 tests cover exactly the scoped behaviors:
1. **Interrupt/stop**: interrupt stops worker, emits "Worker stopped" log
2. **Log entry shape**: every entry has Date timestamp and non-empty message
3. **State transitions**: idle when no tasks; idle→running→idle when task claimed
4. **Worker ID propagation**: custom workerId appears in starting log
5. **Adapter error resilience**: survives queryQueued error, claimTask failure, processClaimedTask defect — all return to idle
6. **Claim contention**: stays idle when another worker claims first
7. **Callbacks**: onTaskComplete fires for success and failure
8. **Log taskId association**: task-related logs carry taskId, lifecycle logs don't

No lifecycle/workflow integration behavior leaks into this suite.

### ✅ AC3: Test titles and assertions align
Each test title precisely describes what it proves:
- "interrupt stops the worker and emits 'Worker stopped' log" → asserts first log contains "Worker starting" and logs include "Worker stopped"
- "worker survives queryQueued adapter error and returns to idle" → injects error, asserts error logged, state returns to idle, worker still alive
- "claim contention: worker stays idle when another worker claims first" → sets claimResult=false, asserts no running state, logs skip message

No test title promises more than its assertions verify.

## Implementation Quality

- **Configurable stubs** with `resetStubs()` called before each test — prevents cross-test pollution
- **`waitFor` helper** with timeout instead of fixed delays — CI-reliable
- **One-shot queue pattern** (`readyQueue` empties after first read) — prevents infinite task loops
- **Bun test isolation suffix** (`?tuiWorker`) — module-level mock isolation
- **Clear ABOUTME header** documenting scope and design intent
