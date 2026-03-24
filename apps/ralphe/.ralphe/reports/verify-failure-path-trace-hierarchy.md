# Verification Report: Harden Failure-Path Trace Hierarchy Behavior

**Date:** 2026-03-24
**Status:** PASS

## Summary

All acceptance criteria for the failure-path trace hierarchy hardening are met. The implementation adds comprehensive deterministic tests in `tests/failurePathHierarchy.test.ts` (702 lines, 14 tests) that verify trace hierarchy correctness under failure scenarios. All 14 tests pass, as do the 35 related tests across 4 other hierarchy test files.

## Acceptance Criteria Verification

### 1. Failure-path tests verify that entered spans still belong to the expected task trace
**PASS** — The `failurePathHierarchy.test.ts` file contains a full `describe` block ("failed attempt spans belong to correct trace") with 4 tests:
- Agent failure inside an attempt preserves hierarchy (trace ID + parent-child assertions)
- Check failure after successful agent preserves both spans in hierarchy
- Nested step failure deep in pipeline preserves full hierarchy (agent, check, git.commit, git.push, git.wait_ci all share one trace)
- Fatal error mid-pipeline skips later spans but preserves earlier ones (unreachable spans are never emitted)

All tests assert shared trace IDs and correct parent span IDs for spans entered before failure.

### 2. Retry failures preserve multiple attempt spans under the same task trace when appropriate
**PASS** — The `describe` block ("retry failures preserve attempt spans under one trace") contains 3 tests:
- All-attempts-fail produces N attempt spans under task.run (3 attempts, all failing, all under same trace)
- First attempt failing + second succeeding preserves both attempt trees (2 attempts with correct span counts)
- CI failure in first attempt and success in second attempt (git spans from both attempts are children of their respective loop.attempt)

Tests verify distinct span IDs per attempt, shared trace ID, and step spans parented to their respective attempt.

### 3. Telemetry remains fail-open under failure-path hierarchy scenarios
**PASS** — The `describe` block ("fail-open under failure-path hierarchy") contains 4 tests:
- Broken tracer (startSpan throws) with failing effect still propagates the effect error
- Broken span.end/setStatus with failing effect still propagates the effect error
- Broken tracer with successful effect still returns the value
- Span status is set to ERROR for failed attempts in a healthy tracer

The `withSpan()` implementation wraps all span operations in try/catch blocks, ensuring telemetry failures never affect task execution.

### 4. The failure-path tests are deterministic and do not require live Axiom access
**PASS** — All tests use `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base`. No network calls, no environment variables required. The `beforeEach`/`afterEach` hooks reset the tracer provider for each test. Tests ran in 166ms.

## Test Execution Results

```
tests/failurePathHierarchy.test.ts: 14 pass, 0 fail, 142 expect() calls (166ms)
tests/traceHierarchy.test.ts + spanHierarchy.test.ts + nestedStepHierarchy.test.ts + attemptSpans.test.ts: 35 pass, 0 fail, 189 expect() calls (321ms)
```

## Implementation Quality

- **Source**: `src/telemetry.ts` — `withSpan()` uses FiberRef-based context propagation with `Effect.locally()` to make child spans active. All span operations are wrapped in try/catch for fail-open behavior.
- **Error propagation**: `Effect.tapError()` sets span status to ERROR; `Effect.onExit()` ends spans on both success and failure paths.
- **No live dependencies**: Tests are fully self-contained with in-memory exporters.
- **Edge cases covered**: Partial pipelines, single-span failures, trace isolation between separate task runs, and broken tracer scenarios.
