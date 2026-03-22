# Verification Report: Scoped TUI Watch Controller Runtime

**Date:** 2026-03-22
**Status:** PASS

## Summary

The scoped TUI watch controller runtime has been correctly implemented. All three acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. Controller as runtime owner for state and command orchestration

**Status: PASS**

`src/tuiWatchController.ts` implements the `TuiWatchController` interface with:
- State ownership: `workerStatus`, `latestTasks`, `refreshError`
- Commands: `refresh()`, `markReady()`, `runEffect()`, `startWorker()`, `stop()`
- State observation via `onStateChange()` listener pattern
- Factory function `createTuiWatchController()` accepting a Layer and options

The controller is created once per TUI session in `watchTui.tsx` (line 78) and serves as the single integration surface for all watch-mode operations.

### 2. Commands reuse one configured TUI runtime

**Status: PASS**

The controller creates a single `ManagedRuntime.make(layer)` instance (line 99 of tuiWatchController.ts). All Effect operations route through the internal `run()` helper which calls `managedRuntime.runPromise()`. This eliminates scattered bare `Effect.runPromise` calls:

- `refresh()` → delegates through `run(queryAllTasks(...))`
- `markReady()` → delegates through `run(markTaskReady(...))`
- `runEffect()` → delegates through `run(effect)`
- Worker loop → receives `runEffect: run` parameter, routing all worker operations through the same runtime
- `useMarkReadyQueue` hook → accepts optional `runMarkReady` override that the controller provides, falling back to bare `Effect.runPromise` only when no controller is present

The remaining `Effect.runPromise` in `useMarkReadyQueue.ts:59` is a fallback for when no scoped runner is provided (backward compatibility). When used through the controller (the standard TUI path), operations go through the controller's runtime.

### 3. Existing visible watch-mode behavior unchanged

**Status: PASS**

- The `WatchApp` component API remains the same — it receives `onRefresh`, `onMarkReady`, `workerStatus` as props
- The CLI entry point (`cli.ts`) still supports both `--headless` and TUI modes
- The headless watcher (`watcher.ts`) is unaffected, sharing the `watchWorkflow.ts` domain logic
- The worker loop (`tuiWorker.ts`) maintains backward compatibility via optional `runEffect` parameter with `Effect.runPromise` fallback

## Test Results

- **Controller tests:** 11/11 pass (`tests/tuiWatchController.test.ts`)
- **Full test suite:** 460/460 pass across 26 files
- **TypeScript:** Clean compilation, no type errors

## Architecture

```
CLI (cli.ts)
  └── launchWatchTui (watchTui.tsx)
        └── createTuiWatchController (tuiWatchController.ts)
              ├── ManagedRuntime.make(TuiLoggerLayer)  ← single runtime
              ├── refresh()     → run(queryAllTasks)
              ├── markReady()   → run(markTaskReady)
              ├── runEffect()   → run(effect)
              └── startWorker() → startTuiWorker(..., runEffect: run)
                    └── processClaimedTask (watchWorkflow.ts)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/tuiWatchController.ts` | Controller interface and factory (203 lines) |
| `src/watchTui.tsx` | TUI entrypoint, creates controller (129 lines) |
| `src/tuiWorker.ts` | Worker with injectable runtime (217 lines) |
| `src/watchWorkflow.ts` | Shared task lifecycle workflow |
| `src/logger.ts` | TuiLoggerLayer for file-only logging |
| `tests/tuiWatchController.test.ts` | 11 unit tests for controller |
