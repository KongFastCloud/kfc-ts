# Verification Report: Dependency-Aware Issue Classification and Backlog Selection

**Date:** 2026-03-24
**Status:** PASS

## Summary

The dependency-aware issue classification and backlog selection feature is correctly implemented across two core modules (`readiness.ts` and `backlog.ts`) with comprehensive test coverage (35 tests, 60 assertions, all passing).

## Acceptance Criteria Verification

### 1. Ralphly classifies delegated issues as actionable, blocked, error-held, or terminal
**PASS** — `IssueReadiness` type in `readiness.ts` defines exactly these four states. `classifyIssue()` applies them in priority order: terminal > error-held > blocked > actionable.

### 2. Blocking relationships from Linear are used to decide whether an issue is actionable
**PASS** — `findBlockingRelation()` checks `inverseRelations` for `type: "blocks"` entries. Non-terminal blockers cause the issue to be classified as blocked. Terminal blockers are correctly ignored (don't block). Unknown blockers conservatively block (safety-first). Only "blocks" relations trigger blocking; "related" and other types do not.

### 3. Parent/sub-issue structure is considered in the readiness model
**PASS** — `checkParentBlocking()` checks if a child's parent is blocked by explicit relations, and the child inherits blocked status. Terminal parents don't block children. Unknown parents don't conservatively block (different from unknown blockers — intentional design choice).

### 4. Backlog selection chooses only actionable issues and skips blocked or terminal work
**PASS** — `selectNext()` in `backlog.ts` filters to actionable items only, sorts by priority (lower number = higher) then creation date (FIFO), and returns the top item. Non-actionable items are included in the result for observability but never selected. `formatBacklogSummary()` logs skip reasons.

### 5. The classification logic is testable independently from blueprints execution
**PASS** — `readiness.ts` is intentionally pure with no Effect or Linear SDK dependencies. Tests use simple data factories (no mocks, no network calls). The test file exercises classification independently from data loading or blueprints execution.

## Test Results

```
bun test v1.3.9
 35 pass
 0 fail
 60 expect() calls
Ran 35 tests across 1 file. [117.00ms]
```

## TypeScript Compilation

```
tsc --noEmit — passed with no errors
```

## Public API

All key functions are exported from `src/index.ts`:
- `classifyIssue`, `classifyAll`, `buildClassificationContext`
- `selectNext`, `selectAllActionable`, `formatBacklogSummary`

## Architecture Notes

- **readiness.ts** — Pure classification logic, no side effects
- **backlog.ts** — Selection layer on top of classification
- **linear/types.ts** — Shared types for Linear data (`LinearIssueData`, `CandidateWork`, etc.)
- **linear/issues.ts** — `isTerminal()` helper used by classifier
- **tests/readiness.test.ts** — 35 tests covering all edge cases

Test coverage includes: terminal states (completed/canceled/duplicate), error-held (session error + errorHeldIds set), explicit blocking (non-terminal/terminal/related/unknown/multiple blockers), parent blocking (blocked parent/unblocked parent/terminal parent/unknown parent), actionable (simple/pending/null session), batch classification, context building, selection priority, FIFO tie-breaking, mixed bag selection, and summary formatting.
