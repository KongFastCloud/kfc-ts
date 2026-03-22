# Verification Report: Scoped TUI Watch Controller Runtime

**Date:** 2026-03-22
**Status:** PASS

## Summary

The scoped TUI watch controller runtime has been correctly implemented. All three acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. TUI watch has a controller responsible for state and command orchestration
**PASS**

- `tuiWatchController.ts` defines a `TuiWatchController` interface and `createTuiWatchController` factory.
- The controller owns observable state: `workerStatus`, `latestTasks`, `refreshError`.
- Commands exposed: `refresh()`, `markReady()`, `runEffect()`, `startWorker()`, `stop()`.
- State change subscription via `onStateChange()` listener pattern.

### 2. TUI commands reuse one configured TUI runtime instead of scattered bare Effect.runPromise calls
**PASS**

- A single `ManagedRuntime` is created once per controller instance (line 99: `ManagedRuntime.make(layer)`).
- All Effect operations route through the internal `run()` helper which calls `managedRuntime.runPromise()`.
- The `watchTui.tsx` entrypoint creates the controller with `TuiLoggerLayer` and wires `onRefresh` and `onMarkReady` callbacks through it.
- `useMarkReadyQueue` accepts a `runMarkReady` override; `WatchApp.tsx` passes the controller's `markReady` method (line 608), ensuring the hook uses the scoped runtime. The bare `Effect.runPromise` fallback (line 59 of useMarkReadyQueue.ts) is only used when no controller override is provided.

### 3. Existing visible watch-mode behavior remains unchanged
**PASS**

- The controller is a transparent architectural boundary — UI components (WatchApp, DashboardView) receive the same props shape.
- The `launchWatchTui` function still follows the same lifecycle: ensure DB → load tasks → create renderer → render WatchApp → start worker → block until quit.
- No UI redesign or public workflow changes were made.

## Test Results

All 11 unit tests pass:

```
bun test v1.3.11
 11 pass
 0 fail
 16 expect() calls
Ran 11 tests across 1 file. [639.00ms]
```

Tests cover:
- Initial state (idle worker, empty tasks)
- refresh() through scoped runtime
- State change listener notification
- markReady() through scoped runtime
- runEffect() for arbitrary effects
- Worker startup and state transitions
- startWorker() idempotency
- Clean stop/dispose
- Multiple listeners
- Refresh error state handling
- Runtime reuse across concurrent commands

## Type Checking

TypeScript compilation passes with zero errors (`tsc --noEmit`).

## Key Files

| File | Role |
|------|------|
| `src/tuiWatchController.ts` | Controller interface + factory with ManagedRuntime |
| `src/watchTui.tsx` | TUI entrypoint; creates controller, wires to UI |
| `src/logger.ts` | TuiLoggerLayer (file-only, no stderr) |
| `src/tui/WatchApp.tsx` | React consumer of controller state/commands |
| `src/tui/useMarkReadyQueue.ts` | Hook with scoped runtime override support |
| `tests/tuiWatchController.test.ts` | 11 unit tests |
