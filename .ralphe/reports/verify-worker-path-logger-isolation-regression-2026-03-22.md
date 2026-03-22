# Verification Report: Worker-Path Logger-Isolation Regression Coverage

**Date:** 2026-03-22
**Task:** Add worker-path logger-isolation regression coverage
**Parent PRD:** /prd/tui-logger-runtime-leak-followup.md
**Status:** PASS

## Test File

`apps/ralphe/tests/shutdownAndLoggerIsolation.test.ts` (823 lines, 25 tests)

## Test Results

- **25 tests passing**, 0 failures
- **39 expect() calls** total
- All 3 worker-path specific tests pass
- Canary positive control test passes

## Acceptance Criteria Verification

### AC1: At least one worker-path regression test emits a real `Effect.log...` through controller-owned worker activity
**PASS** — Multiple tests satisfy this:
- **"worker-path Effect.log from a dependency does not leak to stderr"** (line 222): `queryQueued` dep emits `Effect.logInfo("worker-path-log-should-not-reach-stderr")`
- **"worker-path claim→execute lifecycle logging does not leak to stderr"** (line 297): Three deps (`queryQueued`, `claimTask`, `processClaimedTask`) all emit real `Effect.logInfo` calls
- **"worker-path logging at all Effect log levels stays isolated"** (line 356): Emits `Effect.logDebug`, `Effect.logInfo`, `Effect.logWarning`, and `Effect.logError`
- **"worker activity through controller runtime does not leak to stderr"** (line 179): `queryQueued` emits `Effect.logInfo("worker-activity-isolation-check")`

### AC2: Tests fail if worker-path logging reaches stderr; pass only when TUI-safe runtime owns the worker path
**PASS** — Each worker-path test:
1. Intercepts `console.error` to capture stderr output
2. Starts the worker via the controller (which owns the managed runtime)
3. Waits for worker deps to execute (confirmed via `pollCount` or `waitFor`)
4. Asserts `stderrOutput === ""` and `not.toContain(sentinel)`

The **canary test** (line 266) proves the mechanism works: it creates a `StderrLayer` with `Logger.withConsoleError`, runs `Effect.logInfo("canary-stderr-leak")`, and asserts `stderrOutput.toContain("canary-stderr-leak")` — confirming that if the worker ran on the wrong runtime, the isolation tests would detect the leak.

### AC3: Tests no longer rely solely on silent mocks to prove absence of output leaks
**PASS** — The worker-path tests use deps that actively emit real `Effect.log*` calls (not no-op mocks). The test at line 179 even uses a `pollCount` variable to confirm the logging dep actually executed before checking stderr. The claim→execute lifecycle test (line 297) exercises the full query→claim→process hot-path with logging at each step.

## Architecture Summary

- `TestLayer` replaces the default logger with a no-op logger (simulating the TUI-safe file-only logger)
- Controllers are created with `createTuiWatchController(TestLayer, ...)` — the managed runtime carries the no-op logger
- Worker deps emit real `Effect.log*` calls that would reach stderr if executed on a default runtime
- `console.error` interception captures any stderr leaks
- The canary test with `StderrLayer` serves as a positive control proving the detection mechanism works

## Test Categories

1. **Logger isolation** (10 tests): Controller runEffect, refresh, mark-ready, worker activity, worker-path deps, canary, lifecycle logging, multi-level logging, shutdown logging, periodic refresh, initialLoad
2. **Scoped shutdown** (5 tests): Worker polling halt, periodic refresh halt, mark-ready consumer shutdown, all-subsystems shutdown, double-stop safety
3. **Worker fiber lifecycle** (3 tests): Interrupt + cleanup, idle-before-stop state, no-poll-after-interrupt
4. **Refresh lifecycle** (2 tests): Periodic refresh fires, concurrent refresh/shutdown guard
5. **Mark-ready consumer** (2 tests): Queue drain before stop, pending ID tracking
6. **Full TUI lifecycle** (3 tests): Complete startup→shutdown cycle, state listeners stop after shutdown
