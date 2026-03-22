# Verification Report: Route TUI Refresh Through Controller Commands

**Date:** 2026-03-22
**Status:** PASS

## Summary

All TUI refresh paths are correctly routed through the `TuiWatchController`'s scoped `ManagedRuntime`. The implementation satisfies all three acceptance criteria.

## Acceptance Criteria Verification

### 1. Initial, periodic, manual, and post-task refreshes all flow through one controller-managed Effect path

**PASS**

All four refresh paths converge on `controller.refresh()`, which runs `queryAllTasks(workDir)` through the controller's single `ManagedRuntime`:

- **Initial load** (`watchTui.tsx:70`): `controller.initialLoad()` wraps `controller.refresh()` with graceful error capture.
- **Periodic refresh** (`tuiWatchController.ts:219-226`): `setInterval` calls `controller.refresh()` every `refreshIntervalMs`.
- **Manual refresh** (`WatchApp.tsx`): 'r' key press invokes `onRefresh` prop → `controller.refresh()`.
- **Post-task refresh** (`tuiWatchController.ts:203-207`): Worker's `onTaskComplete` callback fires `controller.refresh()`.

### 2. Refresh behavior stays inside the TUI runtime with no ad hoc bare Effect.runPromise entrypoints

**PASS**

- The controller's `run()` helper (`tuiWatchController.ts:137-140`) is the sole execution path, using `managedRuntime.runPromise()`.
- The worker receives `runEffect: run` from the controller (`tuiWatchController.ts:214`), so all worker Effect operations also route through the managed runtime.
- `useMarkReadyQueue` accepts an `onMarkReady` override from WatchApp (`WatchApp.tsx:601-603`), which delegates to `controller.markReady()`. The bare `Effect.runPromise` in `useMarkReadyQueue.ts:59` is a fallback that is not used when the controller provides `onMarkReady`.
- The only `Effect.runPromise` in `tuiWorker.ts:90` is a fallback default overridden by the controller's `runEffect` option.

### 3. Existing dashboard refresh semantics continue to work

**PASS**

- **Error display**: `refreshError` state is set on failure (`tuiWatchController.ts:174-176`) and passed to `WatchApp` as the `error` prop.
- **Focus preservation**: WatchApp's existing `useEffect` focus-clamping logic remains intact, consuming `tasks` from controller state.
- **Last-refreshed timestamp**: `lastRefreshed` is updated on each successful refresh and passed to WatchApp.
- **Task list replacement**: `latestTasks` is fully replaced on each successful refresh; state change listeners trigger React re-render.

## Test Results

- **464 tests pass, 0 failures** across 26 test files (full suite).
- **15 controller-specific tests** in `tuiWatchController.test.ts` covering: initial state, refresh via scoped runtime, concurrent refresh dedup, initialLoad, periodic refresh, idempotency, state listeners, markReady, runEffect, worker lifecycle, stop/cleanup, error state, and runtime reuse.

## Architecture Notes

- `TuiWatchController` owns a single `ManagedRuntime.make(layer)` instance.
- All commands return Promises backed by the scoped runtime.
- React components consume immutable state snapshots via `controller.getState()` and trigger commands via callback props.
- `controller.onStateChange()` drives re-renders.
- `controller.stop()` cleans up the periodic timer, worker, and disposes the managed runtime.
