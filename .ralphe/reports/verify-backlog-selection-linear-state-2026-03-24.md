# Verification: Backlog Selection Derived from Linear State

**Date:** 2026-03-24
**Status:** PASS

## Summary

Verified that backlog selection has been reworked to derive entirely from Linear-backed state. All four acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. Backlog selection is recomputed from Linear-backed state on each worker iteration
**PASS**

- `runWorkerIteration()` in `worker.ts` calls `loadCandidateWork()` at the top of each iteration (line 185), loading fresh candidate work from Linear every time.
- After loading, it calls `buildClassificationContext()` and `selectNext()` — both pure derivations over the freshly loaded data.
- No stale state carries over between iterations. The worker loop in `runWorkerLoop()` iterates calling `runWorkerIteration()` which always starts with a fresh Linear load.

### 2. The worker no longer depends on a private in-memory backlog or private authoritative hold queue
**PASS**

- The only in-memory state is a transient `inFlight: Set<string>` that tracks issue IDs processed in the current run to prevent double-processing. This is explicitly documented as NOT an authoritative backlog model (worker.ts lines 271-273, 175-176).
- Error-held state is derived from Linear session status (`session.status === "error"`) — see `readiness.ts` line 131 and `worker.ts` `checkForRetries()` which checks `work.session.status !== "error"`.
- Retry feedback is derived from Linear session activities via `findLastErrorTimestamp()`, `findLastErrorSummary()`, and `findPromptedFollowUp()` — all pure functions over Linear activity data.
- The `error-hold.ts` module is a pure function for formatting failure summaries, with no state storage.
- Grep for "private.*queue", "holdQueue", "backlogQueue" found only documentation comments explicitly stating these patterns are NOT used.

### 3. Dependency-aware blocking still participates in selection after the rework
**PASS**

- `readiness.ts` implements full dependency-aware blocking:
  - Explicit blocking relations via `findBlockingRelation()` (lines 159-188)
  - Parent-inherited blocking via `checkParentBlocking()` (lines 198-217)
  - Unknown blockers are conservatively treated as blocking (line 172-174)
- Classification priority order is preserved: terminal > ineligible > error-held > blocked > actionable
- 12+ test cases in `readiness.test.ts` cover blocking scenarios: non-terminal blockers, terminal blockers (unblocked), unknown blockers, parent blocking, multiple blockers, related relations (not blocking)
- Workflow category gating added: only "unstarted" (Todo) and "started" (In Progress) are eligible, filtering out backlog/triage items

### 4. Deterministic selection order remains testable and documented
**PASS**

- `selectNext()` in `backlog.ts` sorts actionable items by: (1) priority (lower number = higher), (2) creation date FIFO within same priority
- `selectAllActionable()` uses the same deterministic ordering
- Test coverage in `readiness.test.ts`:
  - "selects highest priority actionable issue" (line 595)
  - "breaks priority ties by creation date (FIFO)" (line 606)
  - "skips blocked and picks actionable from mixed bag" (line 622)
- Additional ordering tests in `drain.test.ts` (lines 306-383)

## Test Results

- **166 tests pass, 0 failures** across 9 test files
- **330 expect() calls** total
- TypeScript compilation: clean (no errors)
- Key test files:
  - `readiness.test.ts`: 77 tests covering classification, blocking, selection, workflow categories
  - `worker.test.ts`: 26 tests covering follow-up detection, error activity derivation, retry flow
  - `drain.test.ts`: 25 tests covering end-to-end worker behavior with mock layers
  - `error-hold.test.ts`: failure summary construction

## Architecture Observations

- **Pure classification**: `readiness.ts` has no Effect or Linear SDK dependencies — fully testable in isolation
- **Clean separation**: Loading (linear/loader.ts) -> Classification (readiness.ts) -> Selection (backlog.ts) -> Execution (worker.ts)
- **Linear as source of truth**: Session status drives error-held state; session activities drive retry eligibility; workflow state categories drive eligibility
- **No webhook or service orchestration**: Implementation stays on the manual worker path as specified
