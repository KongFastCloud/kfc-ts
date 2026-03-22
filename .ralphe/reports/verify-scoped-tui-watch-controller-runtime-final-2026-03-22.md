# Verification Report: Scoped TUI Watch Controller Runtime

**Date:** 2026-03-22
**Status:** ✅ PASS

## Summary

The scoped TUI watch controller runtime has been correctly implemented. All three acceptance criteria are met.

## Acceptance Criteria Verification

### ✅ AC1: TUI watch has a controller responsible for state and command orchestration

- `tuiWatchController.ts` (204 lines) defines `TuiWatchController` interface and `createTuiWatchController()` factory
- Controller owns observable state: `workerStatus`, `latestTasks`, `refreshError`
- Exposes commands: `refresh()`, `markReady()`, `runEffect()`, `startWorker()`, `stop()`
- State change notification via `onStateChange()` listener pattern

### ✅ AC2: TUI commands reuse one configured TUI runtime

- Controller creates a single `ManagedRuntime.make(layer)` instance at construction time
- All Effect operations route through internal `run()` helper → `managedRuntime.runPromise()`
- Worker receives `runEffect: run` override to use the same runtime (line 186 of controller)
- `tuiWorker.ts` accepts optional `runEffect` parameter (line 64) and uses it for all Effect executions
- `useMarkReadyQueue.ts` accepts optional `runMarkReady` override, falling back to bare `Effect.runPromise` only when no controller is present

### ✅ AC3: Existing visible watch-mode behavior unchanged

- `watchTui.tsx` wires controller state and commands into `WatchApp` component callbacks transparently
- React component receives same prop types (`onRefresh`, `onMarkReady`, `workerStatus`)
- Worker loop logic in `tuiWorker.ts` is structurally unchanged — only the Effect runner is now injectable
- Full test suite: **460 tests pass, 0 failures** across 26 files
- TypeScript type check: **clean, no errors**

## Key Files

| File | Role |
|------|------|
| `src/tuiWatchController.ts` | Controller interface + factory (204 lines) |
| `src/watchTui.tsx` | TUI entrypoint, creates controller, wires to React |
| `src/tuiWorker.ts` | Worker loop with injectable `runEffect` |
| `src/watchWorkflow.ts` | Shared domain workflow (used by both headless and TUI) |
| `tests/tuiWatchController.test.ts` | 11 unit tests for controller |

## Test Results

```
bun test apps/ralphe/tests/tuiWatchController.test.ts
 11 pass, 0 fail, 16 expect() calls [550ms]

bun test apps/ralphe/
 460 pass, 0 fail, 1067 expect() calls [5.02s]
```

## Architecture Notes

- `ManagedRuntime` is created once per TUI session with `TuiLoggerLayer` for file-only logging
- Controller is the single runtime owner — eliminates scattered bare `Effect.runPromise` calls
- React/OpenTUI remain adapter consumers of controller state and commands
- Graceful shutdown: `stop()` disposes runtime and stops worker
- Backward compatibility: `tuiWorker.ts` falls back to `Effect.runPromise` when no override provided (non-TUI usage)
