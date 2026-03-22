# Verification Report: Remove duplicate lifecycle assertions from watchLifecycle tests

**Date:** 2026-03-22
**Status:** ✅ PASS

## Summary

The watchLifecycle test suite has been successfully refactored to focus on worker-layer orchestration, removing duplicate lifecycle assertions that are already canonically owned by watchWorkflow.test.ts.

## Test Results

| Suite | Tests | Assertions | Status |
|-------|-------|------------|--------|
| watchLifecycle.test.ts | 14 | 35 | ✅ All pass |
| watchWorkflow.test.ts | 20 | 84 | ✅ All pass |

## Acceptance Criteria Verification

### ✅ watchLifecycle keeps coverage for worker-specific orchestration

The suite covers 7 owned contracts clearly documented in the file header:

1. **Sequential execution** — `"multiple tasks are processed sequentially"` verifies seq-1 closes before seq-2 is claimed
2. **No-concurrency guarantee** — `"only one task executes at a time"` uses a slow task to verify serialization; `"claim contention causes skip"` verifies lost claims produce no side effects
3. **Callback behavior** — `"onTaskComplete callback fires for each completed task"` and `"onTaskComplete fires after exhausted failure"` verify worker callbacks fire for both outcomes
4. **Claim contention handling** — Tested explicitly with a false claim result
5. **Poll-loop correctness** — `"stale task recovery runs before polling starts"`, `"empty ready queue means no claims"`, `"executor does not independently query for non-queued work"`, `"failed task is not re-polled if Beads excludes it"`
6. **Failure-then-recovery** — `"system processes a successful task after a prior failure"` proves the worker keeps accepting work after a failure
7. **Re-run delegation** — `"ready queue returning same task ID is claimed again"` proves the worker doesn't internally track "already done"

### ✅ Duplicate lifecycle assertions removed

The watchLifecycle suite does NOT re-assert the following contracts, which are exclusively owned by watchWorkflow.test.ts:

| Contract | watchWorkflow owns it | watchLifecycle avoids it |
|---|---|---|
| Metadata timing (startedAt/finishedAt semantics) | ✅ 2 tests, detailed field checks | ✅ No metadata field assertions |
| Operation ordering (read→write→close sequence) | ✅ 2 tests with index comparisons | ✅ Only checks claim→close ordering for sequential execution |
| Default failure reason text | ✅ `"failure with no error message uses default reason"` | ✅ Not tested |
| Previous-error prompt content | ✅ 4 tests covering inclusion/omission/ordering | ✅ Not tested |
| Exhausted-failure metadata fields | ✅ 2 tests with engine/workerId/timing checks | ✅ Only checks task ID routing, not metadata content |
| Prompt building (title/description inclusion) | ✅ `"prompt includes issue title and description"` | ✅ Only checks runTask was invoked with title, not full prompt structure |

### ✅ Suite reads as worker orchestration, not lifecycle re-proof

Evidence:
- **File header** explicitly declares the 7 owned contracts and states lifecycle internals are owned by watchWorkflow.test.ts
- **All describe blocks** are prefixed with `"worker orchestration:"` making the scope clear
- **14 tests total** (down from what would have been a larger set if lifecycle was duplicated) with only 35 assertions — focused and lean
- **No metadata field assertions** — the suite only checks that the right task IDs flow through claim/close/failure paths
- **Two routing tests** (success + failure) verify the worker wires the workflow correctly without re-proving what the workflow does internally

## Architecture

```
watchWorkflow.test.ts (20 tests, 84 assertions)
  └── Canonical lifecycle owner: metadata, ordering, prompts, failure semantics

watchLifecycle.test.ts (14 tests, 35 assertions)
  └── Worker orchestration: sequencing, concurrency, callbacks, poll-loop, recovery
```

## Conclusion

The refactoring successfully separates concerns. watchLifecycle proves the worker integration layer (sequential execution, callbacks, poll-loop, failure recovery) while watchWorkflow owns all lifecycle internals (metadata timing, operation ordering, prompt building, default failure reasons). No duplicate lifecycle assertions remain in watchLifecycle.
