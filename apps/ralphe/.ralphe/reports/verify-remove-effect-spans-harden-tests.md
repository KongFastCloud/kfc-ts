# Verification: Remove Effect span timing and harden tracing tests

**Date:** 2026-03-24
**Status:** PASS

## Acceptance Criteria Verification

### 1. Effect-based span timing removed — OpenTelemetry is the only tracing system
**PASS**

- Searched all source files in `src/` for `Effect.withSpan`, `Effect.span`, and `yield* *.span` patterns — **zero matches found**.
- The `telemetry.ts` module implements a custom `withSpan()` function that wraps Effects in OpenTelemetry spans via `@opentelemetry/api`. This is the only span creation mechanism in the codebase.
- Effect is still used for control flow (`Effect.gen`, `Effect.succeed`, `Effect.fail`, etc.) and logging, but **not** for span-based timing or tracing.
- The PRD states: "OpenTelemetry becomes the only tracing system for this feature. Existing Effect log-span timing should be removed rather than maintained in parallel." — This is satisfied.

### 2. Tests verify agreed span boundaries (task, attempt, step, git)
**PASS**

Four dedicated test files cover span boundaries:

| Test File | Spans Verified | Tests |
|---|---|---|
| `spanHierarchy.test.ts` | task.run, loop.attempt, agent.execute, check.run, git.commit, git.push, git.wait_ci | 7 tests |
| `attemptSpans.test.ts` | agent.execute, check.run, report.verify | 12 tests |
| `gitSpans.test.ts` | git.commit, git.push, git.wait_ci | 11 tests |
| `telemetry.test.ts` | withSpan integration, nested spans | 19 tests |

All 8 agreed span names from the PRD are tested:
- `task.run` — verified with engine and issue.id attributes
- `loop.attempt` — verified with attempt number and retry behavior
- `agent.execute` — verified on success and failure
- `check.run` — verified per check with check.name attribute, no extra attributes
- `report.verify` — verified on success and failure
- `git.commit`, `git.push`, `git.wait_ci` — verified across git modes and failure paths

The `spanHierarchy.test.ts` also verifies that **no span names outside the agreed set** appear.

### 3. Tests verify fail-open behavior
**PASS**

`telemetry.test.ts` contains a dedicated "fail-open behavior" describe block:

- Missing env vars → no-op, effects run normally
- Partial env vars → no-op, no crash
- Invalid AXIOM_DOMAIN → caught by try/catch, fail-open
- `tracer.startSpan` throws → effect still succeeds (returns value 99)
- `span.end` throws → effect still succeeds (returns "still ok")
- `span.setStatus` throws → error still propagates correctly
- Shutdown safe after init with valid config
- Full nested span pipeline runs normally with no-op tracer

### 4. Test strategy does not depend on live Axiom access
**PASS**

- All span hierarchy tests use `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base`
- No network calls, no AXIOM_* env vars needed for test execution
- Fail-open tests use fake tracer providers injected via `traceApi.setGlobalTracerProvider`
- Tests use dependency injection for git operations and engine layers

## Test Results

```
49 pass, 0 fail across 4 tracing test files
574 pass, 0 fail across 30 total test files (full suite)
TypeScript: no errors
```

## Source Code Structure

- `src/telemetry.ts` (192 lines) — OpenTelemetry bootstrap, withSpan Effect wrapper, fail-open design
- `src/runTask.ts` — Uses `withSpan()` for task.run, agent.execute, check.run, report.verify, git.* spans
- `src/loop.ts` — Uses `withSpan()` for loop.attempt spans with attempt metadata
- `cli.ts` — Calls `initTelemetry()` at startup, `shutdownTelemetry()` on exit

## Conclusion

All four acceptance criteria are met. OpenTelemetry is the sole tracing system, span boundaries match the PRD contract, fail-open behavior is tested thoroughly, and no tests depend on live Axiom access.
