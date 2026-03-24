# Verification Report: Linear-backed Readiness and Session Model

**Date:** 2026-03-24
**Slice:** Formalize ralphly's Linear-backed readiness and session model
**Status:** PASS

## Test Results

- **153 tests pass, 0 failures** across 9 test files
- **327 expect() calls** total
- TypeScript compiles cleanly with `--noEmit`

## Acceptance Criteria Verification

### 1. Readiness model explicitly distinguishes actionable, blocked, error-held, and terminal issues
**PASS**

- `IssueReadiness` type in `readiness.ts` defines exactly 5 classifications: `"actionable" | "blocked" | "error-held" | "ineligible" | "terminal"`
- `classifyIssue()` applies them in priority order: terminal > ineligible > error-held > blocked > actionable
- Tests in `readiness.test.ts` cover each classification path with dedicated describe blocks
- `drain.test.ts` integration tests verify classification in the full worker loop context

### 2. Backlog issues are not treated as ready even when delegated
**PASS**

- `READY_WORKFLOW_CATEGORIES` in `readiness.ts` is a strict `Set(["unstarted", "started"])` — backlog is excluded
- `isReadyWorkflowCategory("backlog")` returns false (tested directly)
- Dedicated test: "backlog issue is ineligible even when delegated" (readiness.test.ts line 121) creates an issue with `delegateId: "agent-001"` and `state.type: "backlog"` and asserts `readiness === "ineligible"`
- Dedicated test: "delegated backlog issue is not selected as next work" (readiness.test.ts line 807) verifies `selectNext` returns null
- Dedicated test: "backlog issues are skipped in favor of Todo/In Progress issues" (readiness.test.ts line 822) verifies a higher-priority backlog issue is skipped in favor of a lower-priority Todo issue
- drain.test.ts also tests: "backlog issues are ineligible even when delegated" (line 225)

### 3. Todo/In Progress-class issues are the only workflow categories considered ready candidates
**PASS**

- `READY_WORKFLOW_CATEGORIES` set contains only `"unstarted"` (Todo) and `"started"` (In Progress)
- `isReadyWorkflowCategory` tests exhaustively cover all 7 workflow state types plus null/undefined:
  - unstarted: true
  - started: true
  - backlog: false
  - triage: false
  - completed: false
  - canceled: false
  - duplicate: false
  - null: false
  - undefined: false
- Integration test "only unstarted and started workflow categories are ready" (drain.test.ts line 260) validates the same
- "mixed backlog, triage, and actionable issues classify correctly" test verifies the interplay

### 4. Tests and docs reflect same-session follow-up and active-session reuse behavior
**PASS**

- **Doc comments** in `readiness.ts` (lines 12-20) explicitly document session semantics:
  - Delegation creates a session ("created" event)
  - Follow-up in session UI creates "prompted" event on same session
  - Plain comments and out-of-session mentions are not supported triggers
  - Re-delegation while active session exists reuses that session
- **Doc comments** in `sessions.ts` (lines 2-5) document sessions as the interaction boundary
- `findPromptedFollowUp()` in `worker.ts` detects post-failure follow-up prompts on the same session
- `worker.test.ts` has 8 tests for `findPromptedFollowUp()` covering:
  - No activities → null
  - Non-prompt activities → null
  - Prompts before failure → null
  - Prompts at exact failure time → null (not considered follow-up)
  - Valid post-failure prompt → returns body content
  - Multiple follow-ups → returns newest
  - Missing body field → returns fallback string
- `drain.test.ts` integration tests verify:
  - Runtime error-holds merge with Linear session status
  - Error-held issues are classified and skipped
  - Worker continues processing after failures
- `findActiveSessionsForIssue()` in `sessions.ts` supports active-session reuse by finding non-terminal sessions for an issue, sorted newest-first
- `ErrorHoldStore` tracks in-memory holds keyed by issue ID, enabling same-session retry when prompted follow-up clears the hold

## Key Implementation Files

| File | Purpose |
|------|---------|
| `src/readiness.ts` | Pure readiness classification (267 lines) |
| `src/backlog.ts` | Backlog selection with priority/FIFO ordering (150 lines) |
| `src/worker.ts` | Worker loop with error-hold and retry (311 lines) |
| `src/error-hold.ts` | In-memory error-hold tracking (95 lines) |
| `src/linear/types.ts` | Domain types: WorkflowStateType, CandidateWork, etc. (148 lines) |
| `src/linear/sessions.ts` | Session loading and active-session lookup (171 lines) |
| `src/linear/issues.ts` | Issue loading and isTerminal check (224 lines) |
| `tests/readiness.test.ts` | 70+ classification and selection tests |
| `tests/worker.test.ts` | 8 prompted follow-up detection tests |
| `tests/drain.test.ts` | Full integration tests for worker loop |

## Architecture Notes

- **Linear is source of truth**: Workflow state type from Linear gates eligibility; session status from Linear (merged with runtime holds) gates error-held classification
- **Pure classification layer**: `readiness.ts` has no Effect or Linear SDK dependencies — fully testable with plain data
- **No webhook/server behavior**: This slice is model-only, as specified
- **Explicit over implicit**: The `READY_WORKFLOW_CATEGORIES` set makes it unambiguous which categories are ready; `WorkflowStateType` union type enumerates all 7 Linear categories
