# Verification Report: Scoped TUI Watch Controller Runtime

**Date:** 2026-03-22
**Status:** PASS

## Summary

The scoped TUI watch controller runtime has been correctly implemented. All three acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. TUI watch has a controller responsible for state and command orchestration — PASS

`tuiWatchController.ts` defines:
- `TuiWatchControllerState` interface with `workerStatus`, `latestTasks`, and `refreshError`
- `TuiWatchController` interface with state observation (`getState()`), commands (`refresh()`, `markReady()`, `runEffect()`), lifecycle (`startWorker()`, `stop()`), and event subscription (`onStateChange()`)
- `createTuiWatchController()` factory that creates and owns all state

### 2. TUI commands reuse one configured TUI runtime — PASS

- A single `ManagedRuntime.make(layer)` is created once per controller instance (line 99)
- All Effect operations route through the internal `run()` helper which calls `managedRuntime.runPromise()` (line 127)
- The worker receives `runEffect: run` to funnel its operations through the same runtime (line 186)
- `useMarkReadyQueue` and `WatchApp` accept callback overrides that delegate to the controller
- Remaining bare `Effect.runPromise` calls in `tuiWorker.ts` and `useMarkReadyQueue.ts` are fallback defaults, overridden at runtime when used through the controller

### 3. Existing visible watch-mode behavior remains unchanged — PASS

- `watchTui.tsx` still renders `WatchApp` with the same props interface
- The controller is an internal architectural boundary; no public API changes
- All 460 tests pass (including 11 controller-specific tests) confirming no regressions

## Test Results

```
tuiWatchController.test.ts: 11 pass, 0 fail
Full suite: 460 pass, 0 fail across 26 files (4.96s)
```

### Tests cover:
- Initial state (idle worker, empty tasks)
- `refresh()` runs through scoped runtime and returns tasks
- State change listener notifications
- `markReady()` runs through scoped runtime
- `runEffect()` for arbitrary effects
- Worker startup and state transitions
- `startWorker()` idempotency
- Clean stop/dispose behavior
- Multiple listener support
- Refresh error state handling
- Runtime reuse across concurrent commands

## Architecture

```
watchTui.tsx (entrypoint)
  └── createTuiWatchController(TuiLoggerLayer)
        ├── ManagedRuntime.make(layer) — single runtime instance
        ├── State: workerStatus, latestTasks, refreshError
        ├── Commands: refresh(), markReady(), runEffect()
        ├── Lifecycle: startWorker(), stop()
        └── Events: onStateChange() → triggers WatchApp re-render
```

## Files Reviewed

- `apps/ralphe/src/tuiWatchController.ts` (202 lines) — core controller
- `apps/ralphe/src/watchTui.tsx` (130 lines) — entrypoint wiring
- `apps/ralphe/tests/tuiWatchController.test.ts` (240 lines) — unit tests
- `apps/ralphe/src/tuiWorker.ts` — worker with `runEffect` override
- `apps/ralphe/src/tui/useMarkReadyQueue.ts` — hook with runtime override
