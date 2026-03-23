# Verification Report: Add task and attempt spans to loop execution

**Date:** 2026-03-24
**Status:** PASS

## Summary

The implementation of `task.run` and `loop.attempt` OpenTelemetry spans has been verified as correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Every ralphe task execution emits a `task.run` span — PASS

In `src/runTask.ts` (line 233), the entire task workflow is wrapped in `withSpan("task.run", spanAttributes, fullWorkflow)`. The span attributes include `engine` (always) and `issue.id` (when present). This wrapping occurs inside `runTask()`, which is the single shared entry point for both direct CLI runs and watcher-driven runs.

### 2. Each retry iteration emits a distinct `loop.attempt` child span — PASS

In `src/loop.ts` (lines 86-90), each iteration of the `Effect.iterate` loop body is wrapped in `withSpan("loop.attempt", {...}, attemptBody)`. Since this span is created inside the `task.run` span (which wraps the loop call), each `loop.attempt` is a child of the `task.run` span. Multiple retries produce distinct spans with incrementing attempt numbers.

### 3. Attempt spans carry only the approved minimal attributes — PASS

The `loop.attempt` span attributes are:
- `loop.attempt` — current attempt number (integer)
- `loop.max_attempts` — total max attempts (integer)
- Extra attributes from `spanAttributes` option, which `runTask` sets to:
  - `engine` — "claude" or "codex"
  - `issue.id` — only when an issue ID is present

No task text, issue title, prompt contents, or resume tokens are included in any span. This is verified by a dedicated test (`spans do not include task text or prompt contents`) that asserts only approved attribute keys are present.

### 4. Direct runs and watcher-driven runs both produce the same top-level span structure — PASS

Both code paths use the same `runTask()` function from `src/runTask.ts`:
- **Direct CLI runs**: `src/index.ts` and `src/tuiWorker.ts` call `runTask()` directly
- **Watcher-driven runs**: `src/watchWorkflow.ts` (line 118) calls `deps.runTask(prompt, config, { issueId: issue.id })`

Since both paths converge on the same `runTask()` function, they produce identical span structures: a `task.run` parent span containing `loop.attempt` child spans.

## Implementation Details

### Files Modified
- `src/telemetry.ts` — Core telemetry module with `withSpan()` helper that wraps Effect computations in OTel spans with fail-open error handling
- `src/loop.ts` — Added `withSpan("loop.attempt", ...)` wrapping and `spanAttributes` option to `LoopOptions`
- `src/runTask.ts` — Added `withSpan("task.run", ...)` wrapping and passes `spanAttributes` (engine, issue.id) to loop

### Test Coverage
- `tests/telemetry.test.ts` — 12 tests covering initTelemetry, getTracer, shutdownTelemetry, withSpan (success, failure, no-op tracer, initialized tracer, nested spans)
- `tests/loop.test.ts` — 15 tests including 4 OTel-specific tests:
  - `emits a loop.attempt span for a single successful attempt`
  - `emits distinct loop.attempt spans for each retry`
  - `loop.attempt spans carry approved minimal attributes` (monkey-patches tracer to capture and assert exact attributes)
  - `loop.attempt spans include attempt number on retry`
  - `spans do not include task text or prompt contents`
- `tests/runTask.test.ts` — 12 tests covering orchestration composition

### Test Results
```
538 pass, 0 fail, 1234 expect() calls
Ran 538 tests across 27 files. [5.31s]
```

## Design Notes

- The `withSpan` helper uses a fail-open design: if span creation fails, the Effect runs without tracing
- Span errors are recorded via `SpanStatusCode.ERROR` but never prevent the underlying Effect from completing
- The telemetry module supports graceful degradation when AXIOM env vars are missing (no-op tracer)
- Retry semantics are unchanged — the spans are purely observational wrappers
