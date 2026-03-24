# Verification Report: Task and Attempt Spans Share One Trace

**Date:** 2026-03-24
**Status:** PASS

## Summary

Verified that the implementation correctly ensures `task.run` and `loop.attempt` spans share one trace with correct parent-child relationships. All acceptance criteria are met.

## Test Files Verified

- `tests/traceHierarchy.test.ts` — 7 tests, all passing
- `tests/spanHierarchy.test.ts` — 8 tests, all passing
- `tests/attemptSpans.test.ts` — 11 tests, all passing

## Acceptance Criteria Verification

### 1. Tests fail if `task.run` and `loop.attempt` export as separate traces — PASS

**Evidence:** Multiple tests assert shared trace IDs:
- `traceHierarchy.test.ts` > "nested spans share the same trace ID" — asserts `loopSpan.spanContext().traceId` equals `taskSpan.spanContext().traceId`
- `spanHierarchy.test.ts` > "single attempt produces task.run → loop.attempt → agent.execute → check.run" — asserts all spans share one trace ID
- `spanHierarchy.test.ts` > "all agreed span names are emitted for a full pipeline with git" — iterates ALL finished spans and asserts every one shares the same trace ID

### 2. Tests verify `loop.attempt` is a child of the correct `task.run` span — PASS

**Evidence:**
- `traceHierarchy.test.ts` > "child spans have correct parent span IDs" — asserts `parentSpanIdOf(loopSpan)` equals `taskSpan.spanContext().spanId` and `taskSpan` has no parent (root)
- `spanHierarchy.test.ts` > "single attempt produces..." — asserts `parentSpanIdOf(loopSpan)` equals `taskSpan.spanContext().spanId`
- `spanHierarchy.test.ts` > "all agreed span names..." — asserts the task→attempt parent-child backbone

### 3. Retry flows verify multiple attempt spans appear under the same task trace — PASS

**Evidence:**
- `traceHierarchy.test.ts` > "retry attempts are siblings under the same task trace" — creates 3 attempts, verifies all share same trace ID, all are children of `task.run`, and each has a distinct span ID
- `spanHierarchy.test.ts` > "retry produces two loop.attempt spans under one trace with correct parents" — uses real `loop()` function with `CheckFailure` on first attempt, verifies 2 attempts with correct `loop.attempt` attributes (1 and 2), shared trace ID, and parent = `task.run`

### 4. The tests remain deterministic without live Axiom access — PASS

**Evidence:** All three test files use `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base`. No network calls, no Axiom credentials, no environment-dependent configuration. Each test sets up/tears down its own `BasicTracerProvider` in `beforeEach`/`afterEach`.

## Implementation Details

- `withSpan()` from `src/telemetry.ts` propagates trace context via Effect's `FiberRef`, ensuring child spans inherit the parent's OTel context
- `loop()` from `src/loop.ts` creates `loop.attempt` spans inside the task's trace context
- Helper functions (`spanByName`, `spansByName`, `parentSpanIdOf`) provide clean assertions on real `ReadableSpan` objects

## Test Run Results

```
traceHierarchy.test.ts:  7 pass, 0 fail, 47 expect() calls  [251ms]
spanHierarchy.test.ts:   8 pass, 0 fail, 49 expect() calls  [176ms]
attemptSpans.test.ts:   11 pass, 0 fail, 16 expect() calls  [203ms]
```
