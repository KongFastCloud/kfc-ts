# Verification Report: Move Worker Runtime Ownership into TUI Controller

**Date:** 2026-03-22
**Status:** ✅ PASS

## Summary

The worker runtime ownership has been correctly moved into the TUI controller. The `tuiWatchController.ts` is the single runtime owner for all watch-mode Effect operations, including the worker, periodic refresh, and mark-ready consumer. All operations execute on the controller's `ManagedRuntime` configured with `TuiLoggerLayer`, which suppresses stderr output.

## Acceptance Criteria Verification

### ✅ Worker executes on controller-owned TUI runtime

**Evidence:** In `tuiWatchController.ts` (line 263-298), `startWorker()` calls `tuiWorkerEffect()` to get an `Effect<void, never>` and forks it as a daemon fiber on the controller's `managedRuntime`:

```typescript
void managedRuntime.runPromise(
  Effect.gen(function* () {
    workerFiber = yield* Effect.forkDaemon(workerEffect)
  }),
)
```

The controller does NOT use `startTuiWorker()` (the default-runtime wrapper). That wrapper exists solely for headless/test contexts and is explicitly documented as such (tuiWorker.ts lines 259-269).

### ✅ No default-runtime escape hatch for worker-path Effect logging

**Evidence:**
- `tuiWorkerEffect` returns `Effect<void, never>` — a pure Effect value with no runtime attached.
- When the controller forks this Effect on `managedRuntime`, all `Effect.logInfo`/`logWarning`/`logError` calls within the worker fiber automatically inherit the `TuiLoggerLayer` (file-only, no stderr).
- The `TuiLoggerLayer` in `logger.ts` replaces the default logger with `makeFileLogger()` only — no stderr component.
- Test in `shutdownAndLoggerIsolation.test.ts` ("worker-path Effect.log from a dependency does not leak to stderr") explicitly validates this by injecting an `Effect.logInfo` into a worker dependency and asserting no stderr output.

### ✅ Existing watch behavior preserved

**Evidence:**
- `watchTui.tsx` creates the controller with `TuiLoggerLayer`, runs initial load, starts all subsystems through the controller, and blocks until quit.
- The worker still polls, claims, and executes tasks via the shared `watchWorkflow.ts` pipeline.
- Shutdown path uses `Fiber.interrupt` for clean termination — the worker's `Effect.interruptible` + `Effect.ensuring` guarantees cleanup logging.
- All 438 tests pass across 24 test files with 0 failures.

## Architecture Validation

| Component | Runtime Owner | Verified |
|-----------|--------------|----------|
| Worker fiber | Controller ManagedRuntime | ✅ |
| Periodic refresh fiber | Controller ManagedRuntime | ✅ |
| Mark-ready consumer fiber | Controller ManagedRuntime | ✅ |
| refresh() / initialLoad() | Controller ManagedRuntime | ✅ |
| markReady() / runEffect() | Controller ManagedRuntime | ✅ |
| Queue.offer (enqueueMarkReady) | Controller ManagedRuntime | ✅ |

## Test Results

- **438 tests pass, 0 failures** across 24 test files
- Key test suites validating this feature:
  - `shutdownAndLoggerIsolation.test.ts`: Logger isolation (7 tests) + scoped shutdown (5 tests) + worker fiber lifecycle (3 tests) + refresh lifecycle (2 tests) + mark-ready shutdown (2 tests) + full lifecycle (2 tests)
  - `tuiWatchController.test.ts`: Runtime ownership contracts, state ownership, worker wiring
  - `tuiWorker.test.ts`: Worker unit behavior — interrupt, state transitions, defect survival
  - `logger.test.ts`: TuiLoggerLayer suppresses stderr, AppLoggerLayer writes both

## Key Design Decisions

1. **No `startTuiWorker` in TUI path**: The backward-compatible wrapper (`startTuiWorker`) uses `Effect.runFork` on the default runtime. The TUI controller correctly avoids it, instead forking `tuiWorkerEffect` directly on the managed runtime.
2. **Fiber-based interruption**: Worker uses `Effect.interruptible` + `Effect.forever` pattern — interrupt at any Effect operator, no boolean flags.
3. **Single runtime owner**: All watch-mode operations flow through one `ManagedRuntime.make(layer)` instance, preventing runtime fragmentation.
