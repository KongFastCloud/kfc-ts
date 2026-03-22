# Verification: Shutdown Semantics After Logger Runtime Fix

**Date:** 2026-03-22
**Status:** ✅ PASS
**Parent PRD:** /prd/tui-logger-runtime-leak-followup.md

## Summary

Re-verified shutdown semantics after the runtime-ownership change (worker forked
on controller's ManagedRuntime instead of the default runtime). All three
subsystem shutdown paths — worker interruption, periodic refresh, and mark-ready
queue — remain correct. The full test suite (71 tests, 189 assertions, 0
failures) passes cleanly.

---

## Acceptance Criteria

### 1. Worker interruption still behaves correctly after moving runtime ownership into the controller

**Verdict:** ✅ PASS

**Evidence — code analysis:**

- `tuiWatchController.ts` L263-298: Worker is forked as a daemon fiber via
  `Effect.forkDaemon(workerEffect)` on the controller's `managedRuntime`.
- `tuiWatchController.ts` L373-376: `stop()` interrupts the worker fiber via
  `Fiber.interrupt(workerFiber)` on the same managedRuntime, then nulls the
  handle.
- `tuiWorker.ts` L247-251: Worker effect is annotated with `Effect.interruptible`
  and `Effect.ensuring(…"Worker stopped")`, guaranteeing cleanup runs on interrupt.
- The backward-compat `startTuiWorker()` wrapper (which uses the default runtime)
  is **never called** from TUI code paths — confirmed by grep.

**Evidence — tests (shutdownAndLoggerIsolation.test.ts):**

| Test | Lines | What it proves |
|------|-------|----------------|
| stop() halts worker polling | 494-508 | No new queryQueued calls after stop() |
| fiber interrupt stops worker and fires ensuring cleanup | 595-622 | "Worker stopped" log appears after Fiber.interrupt |
| worker returns to idle before stopping after interrupt during poll sleep | 624-651 | Last state is "idle", not "running" |
| worker fiber does not poll after interrupt | 653-684 | queryQueuedCallCount frozen after interrupt |

### 2. Periodic refresh and queue shutdown semantics remain correct after the worker runtime change

**Verdict:** ✅ PASS

**Evidence — periodic refresh:**

- `tuiWatchController.ts` L345-367: Refresh runs as a daemon fiber with
  `Effect.forever(Effect.sleep → refresh)` on managedRuntime.
- `tuiWatchController.ts` L379-381: `stop()` interrupts refreshFiber and nulls
  the handle.
- Tests: "stop() halts periodic refresh" (L510-526), "periodic refresh fires at
  least once before stop" (L692-703), "refresh-in-flight guard prevents concurrent
  refresh during shutdown" (L706-720).

**Evidence — mark-ready queue:**

- `tuiWatchController.ts` L300-342: Queue created and consumer forked on
  managedRuntime. Consumer uses `Effect.forever(Queue.take → process)`.
- `tuiWatchController.ts` L386-389: `stop()` calls `Queue.shutdown(markReadyQueue)`
  which interrupts the blocked `Queue.take`, ending the consumer loop.
- `tuiWatchController.ts` L244-246: `enqueueMarkReady()` returns early if
  `markReadyQueue` is null (post-stop guard).
- Tests: "stop() shuts down mark-ready consumer — enqueue after stop is a no-op"
  (L528-543), "items enqueued before stop are processed" (L728-742), "pending IDs
  tracked correctly" (L744-763).

### 3. The final logger-isolation and shutdown suite provides confidence that the fix is both effective and safe to maintain

**Verdict:** ✅ PASS

**Evidence — logger isolation regression coverage:**

The test suite includes **non-silent** worker deps that emit real `Effect.logInfo`
/ `logDebug` / `logWarning` / `logError` calls. These would leak to stderr if the
worker ran on the default runtime (the original bug). Key tests:

| Test | Lines | What it proves |
|------|-------|----------------|
| worker-path Effect.log from dependency | 222-264 | Sentinel string does not reach stderr |
| worker-path claim→execute lifecycle logging | 297-354 | query + claim + process logs all suppressed |
| all Effect log levels stay isolated | 356-405 | debug/info/warning/error all suppressed |
| worker shutdown after logging activity | 407-449 | teardown path also stays isolated |
| canary positive control | 266-295 | Proves stderr capture mechanism works (non-vacuous) |

**Evidence — no remaining escape hatches:**

- Only one `ManagedRuntime.make(layer)` call in the TUI path (controller, L162).
- All 9 `managedRuntime.runPromise()` calls are inside the controller.
- No bare `Effect.runPromise`, `Effect.runFork`, or `Effect.runSync` in the TUI
  code path (watchTui.tsx, tuiWatchController.ts).
- `startTuiWorker()` backward-compat wrapper exists but is only used outside TUI;
  clearly documented as not for TUI contexts.

**Evidence — combined lifecycle test:**

"Complete lifecycle: initialLoad → start subsystems → use → stop" (L771-802)
exercises the full TUI startup-to-shutdown sequence and verifies no orphaned
background work (poll count and markReady count frozen after stop).

---

## Test Results

```
shutdownAndLoggerIsolation.test.ts:  25 pass, 0 fail, 39 assertions
tuiWatchController.test.ts:          14 pass, 0 fail, 37 assertions
tuiWorker.test.ts:                   12 pass, 0 fail, 29 assertions
watchWorkflow.test.ts:               20 pass, 0 fail, 84 assertions
                                     ─────────────────────────────
Total:                               71 pass, 0 fail, 189 assertions
```

## Conclusion

The runtime-ownership change is safe. Worker interruption, periodic refresh
shutdown, and queue shutdown all behave correctly when the worker is forked on
the controller's ManagedRuntime. The logger-isolation regression suite — with
real Effect.log calls and a positive-control canary — provides strong confidence
that the fix is both effective and maintainable.
