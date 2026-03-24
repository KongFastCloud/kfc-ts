# Verification: Migrate ralphe watch and Beads flow onto shared workflow builder

**Date:** 2026-03-24
**Status:** PASS

## Summary

The migration of ralphe watch-mode execution and Beads lifecycle wiring onto the shared workflow builder has been correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. ralphe watch executes through the same workflow builder used by ralphe run

**PASS** — Both paths call `buildRunWorkflow(request)` from `buildRunWorkflow.ts`:

- **Direct run** (`cli.ts` line 188): `buildRunWorkflow(request)` with `LogRunObserver` and `DefaultEngineResolverLayer`
- **Watch mode** (`watchWorkflow.ts` line 133-138): `buildRunWorkflow(request)` with `BeadsRunObserver` and injected `engineResolverLayer`
- **TUI watch** (`tuiWorker.ts`): Delegates to `processClaimedTask` which calls `buildRunWorkflow`

There is exactly one workflow definition (`buildRunWorkflow.ts`) and both entrypoints use it.

### 2. Watch-mode request assembly is separate from direct-run request assembly

**PASS** — Two distinct request factories produce the same `RunRequest` type:

- **Direct run**: CLI boundary in `cli.ts` assembles `RunRequest` from CLI flags, config, and positional args
- **Watch mode**: `buildWatchRequest()` in `BeadsRunObserver.ts` assembles `RunRequest` from `BeadsIssue` context, config, and optional previous error

Both produce the same pure-data `RunRequest` interface (task, engine, checks, maxAttempts, gitMode, reportMode). No execution semantics are forked — the difference is purely in how the request data is assembled.

### 3. Beads lifecycle writes for watch mode are owned by RunObserver behavior

**PASS** — `BeadsRunObserver` in `BeadsRunObserver.ts` encapsulates all in-flight Beads writes:

| Observer Method | Beads Write |
|---|---|
| `onStart` | Start metadata (engine, workerId, startedAt) |
| `onAgentResult` | Session comment with resume token |
| `onLoopEvent` | Check-failed / success comments |
| `onComplete` | Final metadata (timing, resume token) |

Post-execution status transitions (`closeTaskSuccess`, `markTaskExhaustedFailure`) correctly remain in `processClaimedTask` because they need to propagate `FatalError`, which the error-free `RunObserver` interface cannot express. This is explicitly documented.

No duplicated orchestration code exists — the watch path expresses lifecycle reactions purely through the `RunObserver` abstraction.

### 4. Existing watch-mode regressions covered after refactor

**PASS** — Full test suite passes:

- **690 tests, 0 failures** across 37 test files
- Key test files covering the refactored code:
  - `BeadsRunObserver.test.ts` — Observer lifecycle, metadata writes, comment formatting, request factory
  - `buildRunWorkflow.test.ts` — Workflow orchestration, step ordering, observer invocation, engine resolution
  - `watchWorkflow.test.ts` — Full task lifecycle (success/failure), metadata timing, previous error inclusion, poll outcomes, shared workflow verification
  - `watchLifecycle.test.ts` — Watch lifecycle regression coverage

### 5. App-level tracing composes cleanly with the new boundary

**PASS** — `buildRunWorkflow` wraps execution in an OTel `task.run` span with engine attribute. Individual steps (`agent.execute`, `check.run`, `report.verify`, `loop.attempt`) have their own spans. The watch path inherits this tracing without needing to duplicate span management. The PRD explicitly states detailed inner span parity is not required.

## Architecture Verification

| Concern | Implementation |
|---|---|
| Single orchestration definition | `buildRunWorkflow.ts` — one place for step ordering |
| Pure-data request | `RunRequest.ts` — no services, layers, or callbacks |
| Observer abstraction | `RunObserver.ts` — composable via `composeObservers()` |
| Watch-specific observer | `BeadsRunObserver.ts` — Beads lifecycle writes |
| Watch-specific request factory | `buildWatchRequest()` in `BeadsRunObserver.ts` |
| Engine resolution | `EngineResolver.ts` — Effect service, not mixed config |
| Dependency injection | `WatchWorkflowDeps` interface enables full testability |
| No duplicated orchestration | No `runTask`-style duplication; legacy `runTask.ts` preserved for backward compat only |

## Test Results

```
690 pass
0 fail
1836 expect() calls
Ran 690 tests across 37 files. [6.58s]
```
