# Verification: Simplify Worker Launch Wrapper to Match Runtime Ownership

**Date:** 2026-03-22
**Status:** PASS

## Task Summary

Verify that the worker launch wrapper was simplified so its API matches runtime ownership reality after the controller runtime fix. The old `startTuiWorker()` function (which launched on the default runtime) should be removed or clearly scoped, and the boundary between controller-owned and helper-owned launch should be explicit.

## Acceptance Criteria Verification

### 1. Worker launch helper no longer implies scoped runtime ownership it does not enforce

**PASS**

- The old `startTuiWorker()` function (which accepted callbacks but launched on the default runtime internally) has been completely removed from `tuiWorker.ts`.
- `tuiWorkerEffect` is now a pure Effect definition with no runtime baked in — it returns `Effect.Effect<void, never>` and the caller decides which runtime to run it on.
- `forkTuiWorker()` requires an explicit `ManagedRuntime` parameter — there is no default-runtime fallback.
- No bare `Effect.runFork` or `Effect.runPromise` calls exist in `tuiWorker.ts`.
- The module-level doc comment explicitly states: "There is no default-runtime fallback — every call site must supply a runtime, making ownership visible and honest."

### 2. Boundary between controller-owned worker launch and lower-level helper is explicit and maintainable

**PASS**

- **Controller path:** `tuiWatchController.ts` imports `tuiWorkerEffect` and forks it as a daemon fiber directly on `managedRuntime` (lines 293-297). The controller is the single runtime owner — all Effects (worker, refresh, mark-ready) run through it.
- **Test/external path:** `forkTuiWorker()` in `tuiWorker.ts` provides an imperative wrapper that requires an explicit runtime. Its doc comment clearly states it is for "tests and other call sites" and that "the TUI controller passes its controller-owned runtime."
- These two paths have distinct purposes and neither has a hidden default-runtime escape hatch.
- The `TuiWatchControllerDeps` interface includes `tuiWorkerEffect` as an injectable dependency, allowing tests to substitute the worker without touching runtime ownership.

### 3. Tests and supported call sites still have a clear way to start and stop worker execution

**PASS**

- `forkTuiWorker(runtime, callbacks, opts)` returns a `TuiWorkerHandle` with a `stop()` method for clean fiber interruption.
- Tests in `restartRecovery.test.ts` use `forkTuiWorker` with their own test runtime.
- Tests in `tuiWatchController.test.ts` exercise the controller's `startWorker()`/`stop()` lifecycle.
- Tests in `shutdownAndLoggerIsolation.test.ts` verify logger isolation through the worker path with real `Effect.log` calls.

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| shutdownAndLoggerIsolation.test.ts | 25 | PASS |
| tuiWatchController.test.ts | 14 | PASS |
| tuiWorker.test.ts | 12 | PASS |
| restartRecovery.test.ts | 20 | PASS |
| **Full suite (all 24 files)** | **442** | **PASS** |

## Key Implementation Details

- `tuiWorkerEffect` is a pure Effect with no runtime coupling (lines 94-257 of tuiWorker.ts)
- `forkTuiWorker` requires explicit `ManagedRuntime` — no default fallback (lines 280-294)
- Controller forks worker via `managedRuntime.runPromise(Effect.forkDaemon(workerEffect))` (line 293-297 of tuiWatchController.ts)
- No `startTuiWorker` references remain in source code (only in old report files)
- No bare `Effect.runFork` or `Effect.runPromise` in worker or controller source

## Conclusion

The worker launch wrapper has been correctly simplified to match runtime ownership. The API is honest — no function implies scoped runtime safety while secretly using the default runtime. The two launch paths (controller-owned fork and explicit-runtime helper) are clearly separated, well-documented, and fully tested.
