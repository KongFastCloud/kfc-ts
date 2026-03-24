# Verification: Persist Failure Holds and Retry Eligibility in Linear

**Date:** 2026-03-24
**Status:** PASS

## Summary

All four acceptance criteria are satisfied. Failure hold semantics are fully backed by Linear state (session status + session activities), with no private in-memory ErrorHoldStore. The implementation is well-tested with 180 passing tests.

## Test Results

```
180 pass, 0 fail, 358 expect() calls
Ran 180 tests across 9 files. [156.00ms]
```

## Acceptance Criteria Verification

### 1. A failed issue becomes visibly and queryably error-held through Linear-backed state

**PASS**

- `runner.ts`: On terminal failure, writes a durable error activity to the Linear session via `formatErrorActivity()` — format: `"Failed after N attempt(s): <error>"`
- `readiness.ts`: `classifyIssue()` classifies issues as `"error-held"` via dual-sourced detection:
  - Source 1: Session status `"error"` (Linear API field)
  - Source 2: Activity-derived `errorHeldIds` set (built from session activities)
- Tests confirm: `drain.test.ts` — "error-held issues are skipped during classification", "error-held state is derived from Linear session status", "activity-derived error-held set marks issues even without error session status"

### 2. A fresh manual ralphly invocation can determine that an issue is error-held and why it failed

**PASS**

- `worker.ts`: `buildErrorHeldIds()` loads session activities from Linear on each iteration and scans for unresolved error markers
- `worker.ts`: `findLastErrorTimestamp()` and `findLastErrorSummary()` derive failure context from Linear activities
- No process-local state is needed — all state is reconstructed from Linear on each invocation
- Tests confirm: `drain.test.ts` — "fresh invocation detects error-held issue from Linear session status", "fresh invocation can read failure reason from session activities", "follow-up after error enables retry on fresh invocation"

### 3. Same-session follow-up can clear or supersede the hold and trigger retry with prior failure context

**PASS**

- `worker.ts`: `findPromptedFollowUp()` detects `"prompt"` type activities after the last error timestamp
- `worker.ts`: `checkForRetries()` builds combined feedback: error summary + user follow-up text
- `runner.ts`: `buildTaskInput()` appends retry feedback as `"## Previous Attempt Feedback"` section
- `worker.ts`: `buildErrorHeldIds()` does NOT mark an issue as error-held if a follow-up exists after the last error (the follow-up clears the hold)
- Tests confirm: `worker.test.ts` — full "error -> follow-up -> retry flow" test suite; `drain.test.ts` — "retry feedback is derived from session activities (no private store)", "same-session follow-up continues the existing session"

### 4. Failure hold semantics no longer depend on a process-local ErrorHoldStore as the source of truth

**PASS**

- Grep for `ErrorHoldStore` returns zero matches (only comments documenting that no private hold store exists)
- `error-hold.ts` header comment: "Error-held state is derived entirely from Linear session status -- the worker does not maintain a private in-memory hold queue."
- `readiness.ts` header comment: "Both sources are derived from Linear -- no private in-memory hold store."
- `worker.ts`: The only transient state is the `inFlight` set (issue IDs processed in this run) — documented as NOT an authoritative backlog model, discarded on exit
- The `ClassificationContext.errorHeldIds` set is rebuilt from Linear session activities on each worker iteration

## Architecture Summary

| Component | Role |
|-----------|------|
| `error-hold.ts` | Pure failure summary formatting (`buildFailureSummary`) |
| `readiness.ts` | Dual-sourced error-held classification (session status + activity-derived) |
| `worker.ts` | Worker loop with `buildErrorHeldIds`, `checkForRetries`, `findPromptedFollowUp` |
| `runner.ts` | Writes durable error activity to Linear on failure; appends retry feedback |
| `linear/activities.ts` | Activity formatting (`formatErrorActivity`) and writing |
| `linear/sessions.ts` | Session loading and activity retrieval from Linear |

## Key Design Properties

- **Dual-sourced error detection**: Both session status "error" and activity-derived markers are checked
- **Durable across process restarts**: Activities persist in Linear; fresh invocations reconstruct state
- **No private database or queue**: All hold state lives in Linear
- **Fire-and-forget activity writes**: Failures to write activities are logged but never block execution
- **Session-based retry contract**: Follow-ups on the same session clear holds and trigger retry
