# Verification: Ralphly Local Workflow Assembly

**Date:** 2026-03-24
**Task:** Rewrite ralphly issue execution to use local workflow assembly
**Status:** PASS

## Summary

Ralphly's issue execution has been successfully migrated from `blueprints.run()` to local workflow assembly using blueprints primitives. All acceptance criteria are met.

## Verification Results

### Tests
- **255 tests pass**, 0 failures, 626 expect() calls across 11 test files
- Test suite covers: acceptance (e2e), runner, worker, drain, readiness, error-hold, config, and linear modules

### Type Check
- `tsc --noEmit` passes cleanly

### Lint
- 0 errors, 14 warnings (all unused imports — cosmetic only)

## Acceptance Criteria Verification

### 1. No dependency on blueprints.run()
**PASS** — `grep` for `blueprints.run` across `apps/ralphly/` returns zero matches. The runner imports only primitives: `loop`, `agent`, `cmd`, `report`, `buildCiGitStep`, `executePostLoopGitOps`, `defaultGitOps`, and types (`Engine`, `AgentResult`, `LoopEvent`, `FatalError`, `GitMode`).

### 2. Session-write contract intact
**PASS** — `runner.ts` explicitly owns all lifecycle writes:
- **start** → `formatStartActivity()` written before execution begins
- **check_failed** → `mapLoopEventToActivity()` written via `onEvent` callback during retry loop
- **success** → `formatSuccessActivity()` written post-execution on success
- **error** → `formatErrorActivity()` written post-execution on failure

Every run produces exactly: `start → [check_failed…] → success | error`. Terminal writes happen in the runner's post-execution logic, not in the onEvent callback.

### 3. Retry feedback propagation and same-session retry
**PASS** — `buildTaskInput()` appends retry feedback to the prompt when provided. `RunIssueOptions.retryFeedback` carries failure context from previous runs. `IssueRunResult.failureSummary` is populated on failure via `buildFailureSummary()` for downstream retry use.

### 4. Backlog draining and durable error-held behavior
**PASS** — Worker loop (`worker.ts`) processes issues one at a time, continues after failures, and exits with structured reason codes (`no_candidates`, `no_actionable`, `backlog_drained`, `iteration_limit`). Error-held detection is dual-sourced: session status "error" OR unresolved error activity in session history (durable across CLI restarts). Hold is cleared only when a prompted follow-up arrives after the error timestamp.

### 5. No hidden local runner abstraction
**PASS** — `runIssue()` in `runner.ts` is a flat, visible function that assembles the workflow inline:
```
loop(agent → checks → report → ciGitStep) → postLoopGitOps
```
It does not delegate to a shared runner, abstract factory, or hidden orchestration layer. The composition is local to the function body.

## Key Files

| File | Role |
|------|------|
| `src/runner.ts` | Issue execution with local workflow assembly |
| `src/worker.ts` | Worker loop, backlog draining, error-held detection |
| `src/backlog.ts` | Backlog selection logic |
| `src/readiness.ts` | Issue classification (terminal/ineligible/error-held/blocked/actionable) |
| `src/error-hold.ts` | Failure summary construction |
| `src/linear/activities.ts` | Session activity formatting |
| `src/linear/sessions.ts` | Session management and activity loading |
| `tests/acceptance.test.ts` | End-to-end acceptance tests |
| `tests/runner.test.ts` | Runner unit tests |
| `tests/worker.test.ts` | Worker loop tests |
| `tests/drain.test.ts` | Backlog draining tests |
