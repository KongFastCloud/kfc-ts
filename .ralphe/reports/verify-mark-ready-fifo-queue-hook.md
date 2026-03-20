# Verification: Mark-Ready FIFO Queue Hook with Serial Drain

**Date:** 2026-03-20
**Status:** PASS

## Summary

The `useMarkReadyQueue` hook has been correctly implemented in `apps/ralphe/src/tui/useMarkReadyQueue.ts` with comprehensive test coverage in `apps/ralphe/tests/useMarkReadyQueue.test.ts`.

## Implementation Review

The implementation uses a clean two-layer architecture:

1. **`MarkReadyQueueEngine`** (framework-agnostic, testable class):
   - Internal `_queue` array for FIFO ordering
   - `_inFlightId: string | null` for tracking the currently-processing task
   - `_draining` flag to prevent concurrent drain loops
   - `enqueue()` rejects duplicates by checking both queue and in-flight ID
   - `_drain()` processes items serially via async/await loop with try/catch for error swallowing
   - `pendingIds` getter returns a `Set<string>` of all queued + in-flight IDs
   - Calls `_onDrain` (doRefresh) after each completion, and `_onStateChange` for React re-renders

2. **`useMarkReadyQueue`** (React hook wrapper):
   - Initializes the engine once via `useRef`
   - Uses `useState` tick counter for re-renders on state changes
   - Uses `useRef` for `doRefresh` to avoid stale closure issues
   - Wires `Effect.runPromise(markTaskReady(id, labels))` as the runner
   - Returns `{ enqueue, pendingIds }` as specified

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Hook enqueues multiple tasks and drains in FIFO order | PASS | Test "drains items in FIFO order" - enqueues a, b, c and verifies serial execution order |
| Duplicate task IDs are rejected (no double-enqueue) | PASS | Tests "rejects duplicate task IDs already in the queue" and "rejects duplicate task IDs currently in-flight" |
| doRefresh() called after each individual mark-ready completes | PASS | Test "calls doRefresh after each individual completion" - verifies refresh count increments after each resolution |
| Failed mark-ready operations are silently swallowed; drain continues | PASS | Test "silently swallows errors and continues draining" - rejects first item, verifies drain continues to b and c |
| Exposed ID set includes both queued and in-flight task IDs | PASS | Test "pendingIds includes both queued and in-flight IDs" - verifies all 3 IDs present, then shrinks as items complete |
| Unit tests cover FIFO order, dedup, drain-after-failure | PASS | All 8 tests pass (see below) |

## Test Results

```
bun test v1.3.11
 8 pass
 0 fail
 44 expect() calls
Ran 8 tests across 1 file. [125.00ms]
```

Tests:
1. drains items in FIFO order
2. rejects duplicate task IDs already in the queue
3. rejects duplicate task IDs currently in-flight
4. calls doRefresh after each individual completion
5. silently swallows errors and continues draining
6. pendingIds includes both queued and in-flight IDs
7. items enqueued while drain is in progress are picked up
8. does nothing when queue is empty

## Notes

- The hook is not yet wired into WatchApp.tsx (WatchApp still calls `markTaskReady` directly). Per the task notes, WatchApp integration is a separate concern.
- No changes were made to the beads module (`markTaskReady` stays as-is), as specified.
- Type-checking passes for the hook file (pre-existing tsc issues in beads.ts are unrelated).
