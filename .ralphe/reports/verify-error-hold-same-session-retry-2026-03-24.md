# Verification: Error-Hold and Same-Session Retry Behavior

**Date:** 2026-03-24
**Status:** PASS

## Summary

The error-hold and same-session retry behavior is correctly implemented across the ralphly worker runtime. All acceptance criteria are satisfied and verified through passing tests and code review.

## Acceptance Criteria Verification

### 1. Terminal issue failures are recorded as error-held instead of stopping the whole worker
**PASS** — In `worker.ts`, `runWorkerIteration()` catches failed `runIssue()` results (lines 174-185) and records an `ErrorHoldRecord` in the `ErrorHoldStore` instead of propagating the failure. The worker loop in `runWorkerLoop()` continues iterating after a failure, incrementing `errorHeld` count. A safety bound of 100 iterations prevents infinite loops.

### 2. Ralphly writes a terminal error activity to the active Linear session on exhausted failure
**PASS** — In `runner.ts`, when `result.success` is false (lines 177-185), `writeActivity()` is called with `formatErrorActivity()` which writes a "Failed after N attempt(s): <error>" message to the Linear session. This is fire-and-forget (errors logged, never propagated). The `formatErrorActivity()` function is defined in `linear/activities.ts` (line 82-85).

### 3. Ralphly records a short failure summary for later retry feedback
**PASS** — `buildFailureSummary()` in `error-hold.ts` constructs a summary in format `"Failed after N attempt(s): <error_text>"`, truncated to 500 characters. The `IssueRunResult` interface includes a `failureSummary` field (populated when `success: false`). The `ErrorHoldRecord` stores this summary with `issueId`, `sessionId`, and `failedAt` timestamp. Tests verify formatting, truncation, and undefined error handling.

### 4. A prompted follow-up on the same session can clear error-hold and retry the issue
**PASS** — `checkForRetries()` in `worker.ts` iterates error-held candidates, loads session activities via `loadSessionActivities()`, and calls `findPromptedFollowUp()` to detect prompt-type activities after the failure timestamp. When found, the hold is cleared, combined feedback is built (`failureSummary + "\nUser follow-up: <prompt>"`), and `runIssue()` is called with `retryFeedback`. If the retry also fails, the hold is re-recorded. The `buildTaskInput()` function appends retry feedback under a "## Previous Attempt Feedback" heading. 10 tests verify `findPromptedFollowUp()` edge cases.

### 5. Failed issues do not block the worker from continuing with other actionable issues
**PASS** — `buildClassificationContextWithHolds()` merges runtime error-hold IDs into the classification context's `errorHeldIds` set. `classifyIssue()` in `readiness.ts` classifies these as "error-held", and `selectNext()` in `backlog.ts` only returns "actionable" issues. This ensures error-held issues are skipped in subsequent iterations while other actionable issues are processed.

## Test Results

- **Ralphly:** 109 tests pass, 0 failures, 211 assertions
- **Blueprints:** 28 tests pass, 0 failures, 53 assertions
- **TypeScript:** Compiles cleanly (`tsc --noEmit` passes)

### Key Test Coverage
- `error-hold.test.ts`: ErrorHoldStore operations (record, clear, overwrite, heldIds), buildFailureSummary formatting/truncation (11 tests)
- `worker.test.ts`: findPromptedFollowUp timing, filtering, edge cases (9 tests)
- `runner.test.ts`: buildTaskInput with/without retry feedback, runIssue error activity writing (10 tests)
- `readiness.test.ts`: error-held classification from session status and errorHeldIds set (3 tests)

## Architecture Notes

- **ErrorHoldStore** is intentionally pure (no Effect/Linear dependencies) — simple Map-based in-memory store scoped to a single worker run
- Session activities are fire-and-forget to avoid blocking execution on Linear API failures
- Classification merges runtime holds with Linear session status to prevent re-selecting failed issues within the same loop iteration
- The worker loop creates a fresh ErrorHoldStore per run, ensuring clean state boundaries

## Files Reviewed
- `apps/ralphly/src/error-hold.ts` — ErrorHoldStore and buildFailureSummary
- `apps/ralphly/src/worker.ts` — Worker loop, iteration, retry detection, classification merging
- `apps/ralphly/src/runner.ts` — Issue runner with failure summary and retry feedback integration
- `apps/ralphly/src/linear/activities.ts` — Terminal error activity formatting and writing
- `apps/ralphly/src/readiness.ts` — Error-held classification
- `apps/ralphly/src/index.ts` — Public API exports (error-hold and worker modules exported)
- `apps/ralphly/tests/error-hold.test.ts` — Error-hold store and summary tests
- `apps/ralphly/tests/worker.test.ts` — Prompted follow-up detection tests
- `apps/ralphly/tests/runner.test.ts` — Runner integration tests
