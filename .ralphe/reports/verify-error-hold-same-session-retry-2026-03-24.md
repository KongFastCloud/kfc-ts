# Verification: Error-Hold and Same-Session Retry Behavior

**Date:** 2026-03-24
**Status:** PASS

## Summary

The error-hold and same-session retry behavior is correctly implemented across the ralphly worker runtime. Error-held state is derived entirely from Linear-backed state (session status + session activities) — no private in-memory hold store exists. All acceptance criteria are satisfied and verified through passing tests and code review.

## Acceptance Criteria Verification

### 1. A failed issue becomes visibly and queryably error-held through Linear-backed state
**PASS** — On terminal failure, `runIssue()` in `runner.ts` writes a durable error activity to the Linear session via `formatErrorActivity()`: `"Failed after N attempt(s): <error>"`. This activity persists in Linear and is queryable on any future run. The worker's `buildErrorHeldIds()` function loads session activities and checks for unresolved error markers to build the `errorHeldIds` set, which is passed to `buildClassificationContext()` for classification. This dual-sourced approach (session status + activities) ensures error-held state is detectable regardless of what Linear does with the session status field.

### 2. A fresh manual ralphly invocation can determine that an issue is error-held and why it failed
**PASS** — `buildErrorHeldIds()` in `worker.ts` loads session activities for each candidate via `loadSessionActivities()` and checks for error activities without a follow-up. `findLastErrorSummary()` extracts the failure reason text. `classifyIssue()` in `readiness.ts` checks both `sessionStatus === "error"` and the `errorHeldIds` set in `ClassificationContext`. This works across process restarts because activities are persisted in Linear.

### 3. Same-session follow-up can clear or supersede the hold and trigger retry with prior failure context
**PASS** — `checkForRetries()` in `worker.ts` iterates candidates with error sessions, loads session activities, calls `findLastErrorTimestamp()` to locate the error, then `findPromptedFollowUp()` to detect prompt-type activities after the failure. When a follow-up is found, combined feedback is built (`errorSummary + "\nUser follow-up: <prompt>"`) and `runIssue()` is called with `retryFeedback`. `buildTaskInput()` appends this under a "## Previous Attempt Feedback" heading. The follow-up also causes `buildErrorHeldIds()` to exclude the issue from the held set, clearing the hold for classification.

### 4. Failure hold semantics no longer depend on a process-local ErrorHoldStore as the source of truth
**PASS** — No `ErrorHoldStore` class exists in the codebase. Error-held state is dual-sourced from Linear:
- Session status `"error"` (when Linear sets it)
- Activity-derived `errorHeldIds` (built by `buildErrorHeldIds()` from session activity history)

Both sources are durable across process lifetimes. The `ClassificationContext.errorHeldIds` field carries the activity-derived set into the pure classification module without adding Effect dependencies to it.

### 5. Failed issues do not block the worker from continuing with other actionable issues
**PASS** — `classifyIssue()` classifies error-held issues (from either source) as `"error-held"`, and `selectNext()` only returns `"actionable"` issues. The worker loop in `runWorkerLoop()` continues iterating after a failure, incrementing the `errorHeld` count. A safety bound of 100 iterations prevents infinite loops.

## Test Results

- **Ralphly:** 180 tests pass, 0 failures, 358 assertions
- **Blueprints:** 28 tests pass, 0 failures, 53 assertions
- **TypeScript:** Compiles cleanly (`tsc --noEmit` passes)

### Key Test Coverage
- `error-hold.test.ts`: buildFailureSummary formatting/truncation (4 tests)
- `worker.test.ts`: findPromptedFollowUp timing/filtering, isErrorActivity, getActivityBody, findLastErrorTimestamp, findLastErrorSummary, error→follow-up→retry flow (27 tests)
- `runner.test.ts`: buildTaskInput with/without retry feedback, runIssue activity writing (7 tests)
- `readiness.test.ts`: error-held classification from session status, activity-derived errorHeldIds, precedence rules, dual-source verification (10 tests)
- `drain.test.ts`: durable error-held state across runs, activity-derived selection blocking, fresh invocation reconstruction (8 tests)

## Architecture Notes

- Error-held state is **dual-sourced** from Linear — both session status and session activities
- The activity-based path (`buildErrorHeldIds`) is the primary durable mechanism, since the Linear SDK does not expose a way to set session status directly
- `ClassificationContext.errorHeldIds` carries activity-derived holds into the pure classification module
- Session activities are fire-and-forget to avoid blocking execution on Linear API failures
- No private in-memory hold queue or ErrorHoldStore exists — all hold truth comes from Linear

## Files Reviewed
- `apps/ralphly/src/error-hold.ts` — buildFailureSummary (pure, no Effect)
- `apps/ralphly/src/worker.ts` — Worker loop, buildErrorHeldIds, retry detection, activity scanning
- `apps/ralphly/src/runner.ts` — Issue runner with durable error activity writing
- `apps/ralphly/src/readiness.ts` — Dual-sourced error-held classification (session status + errorHeldIds)
- `apps/ralphly/src/linear/activities.ts` — Error activity formatting and writing
- `apps/ralphly/src/backlog.ts` — Selection logic (skips error-held)
- `apps/ralphly/src/index.ts` — Public API exports (buildErrorHeldIds exported)
- `apps/ralphly/tests/error-hold.test.ts` — Failure summary tests
- `apps/ralphly/tests/worker.test.ts` — Activity detection and follow-up tests
- `apps/ralphly/tests/runner.test.ts` — Runner integration tests
- `apps/ralphly/tests/readiness.test.ts` — Classification with errorHeldIds tests
- `apps/ralphly/tests/drain.test.ts` — Durable error-held state and cross-run tests
