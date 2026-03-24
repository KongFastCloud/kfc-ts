# Verification Report: Fix active trace context in withSpan

**Date:** 2026-03-24
**Status:** PASS

## Summary

The implementation correctly fixes the core telemetry bug where `withSpan()` was not activating the OpenTelemetry context for the wrapped Effect, causing nested spans to arrive as disconnected root spans instead of a coherent trace tree.

## Implementation Review

**File:** `apps/ralphe/src/telemetry.ts`

The fix uses a FiberRef-based context propagation model:

1. **`OtelContextRef`** (FiberRef) carries the current OpenTelemetry context through Effect fibers.
2. On each `withSpan()` call:
   - Reads the parent context from `OtelContextRef` (line 164)
   - Starts a new span as a child of that parent context (line 168)
   - Creates a child context with the new span set as active (line 174)
   - Uses `Effect.locally(OtelContextRef, childCtx)` to propagate the child context to nested work (line 177)
3. Error handling and span lifecycle (tapError, onExit) are correctly wrapped in try/catch for fail-open behavior.

This approach avoids reliance on AsyncLocalStorage and instead uses Effect's native FiberRef for context propagation, which is correct for the Effect runtime model.

## Acceptance Criteria Verification

### 1. Nested `withSpan()` calls inherit active trace context
**PASS** - Verified by `traceHierarchy.test.ts`:
- "nested spans share the same trace ID" - all 3 nested spans share one traceId
- "child spans have correct parent span IDs" - loop.attempt -> task.run, agent.execute -> loop.attempt
- "full orchestration hierarchy mirrors expected tree" - 5 spans in correct parent-child relationships

### 2. A ralphe task run can export one coherent trace tree
**PASS** - Verified by `spanHierarchy.test.ts` which tests the full orchestration pipeline (task.run > loop.attempt > [agent.execute, check.run, report.verify]) and confirms all spans share one trace ID.

### 3. The fix does not require changing span names or attribute contract
**PASS** - The span names (`task.run`, `loop.attempt`, `agent.execute`, `check.run`, `report.verify`, `git.commit`, `git.push`, `git.wait_ci`) and attributes remain unchanged. The fix is entirely within the `withSpan()` helper.

### 4. Telemetry remains fail-open
**PASS** - Verified by `telemetry.test.ts`:
- `withSpan` succeeds when `tracer.startSpan` throws
- `withSpan` succeeds when `span.end` throws
- `withSpan` propagates failure when `span.setStatus` throws (error from Effect, not from tracing)
- Effects run normally with no env config (no-op tracer)

## Test Results

All **45 tests** pass across 4 test files:

| File | Tests | Status |
|------|-------|--------|
| `tests/traceHierarchy.test.ts` | 7 | PASS |
| `tests/telemetry.test.ts` | 19 | PASS |
| `tests/spanHierarchy.test.ts` | 8 | PASS |
| `tests/attemptSpans.test.ts` | 11 | PASS |

## Additional Observations

- The implementation correctly handles retry scenarios (multiple loop.attempt siblings under one task.run)
- Sibling spans (agent.execute, check.run, report.verify) correctly share the same parent
- Error propagation through the span hierarchy is correct (errors don't break parent-child relationships)
- Each separate `Effect.runPromise` call creates an independent trace (correct isolation)
- No changes to call sites (runTask.ts, loop.ts) were required - the fix is entirely in the telemetry abstraction layer
