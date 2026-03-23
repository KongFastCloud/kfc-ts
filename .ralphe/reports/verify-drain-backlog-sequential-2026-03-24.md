# Verification Report: Drain Backlog Sequentially

**Date:** 2026-03-24
**Task:** Drain backlog sequentially until no actionable issues remain
**Status:** PASS

## Summary

The sequential backlog drain loop is correctly implemented across `apps/ralphly/`. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Ralphly can manually query Linear for available work and process issues sequentially
**PASS** — The CLI (`cli.ts`) provides `ralphly run` and `ralphly run --dry-run` commands. The worker loop (`worker.ts::runWorkerLoop`) loads candidate work via `loadCandidateWork()`, classifies issues, and processes them one at a time through blueprints. The loop iterates until no actionable work remains. Dry-run mode previews the backlog without processing.

### 2. Only actionable issues are processed; blocked and error-held issues are skipped
**PASS** — The readiness classifier (`readiness.ts::classifyIssue`) categorizes issues into 4 states: actionable, blocked, error-held, terminal. The backlog selector (`backlog.ts::selectNext`) filters to actionable-only and sorts by priority then FIFO. Tests confirm blocked (via explicit relations), error-held (via session status or runtime holds), and terminal issues are all correctly skipped.

### 3. The worker continues after individual issue failures instead of terminating globally
**PASS** — When `runIssue` returns a failure, the worker records it in `ErrorHoldStore` and continues to the next iteration (`worker.ts` lines 174-185). The error-hold store is in-memory and keyed by issue ID. Failed issues are classified as error-held in subsequent iterations, preventing re-selection. Tests verify this behavior.

### 4. The worker exits cleanly only when no actionable issues remain
**PASS** — `runWorkerLoop` exits the loop when `runWorkerIteration` returns a null `runResult` (no actionable work), logging a completion summary with processed/succeeded/error-held/retried counts. A safety bound of 100 iterations prevents infinite loops.

### 5. The resulting manual-first loop demonstrates the full first-slice worker behavior from the PRD
**PASS** — The implementation covers all PRD requirements for the first slice:
- Issue deduplication via session-aware candidate loading
- Dependency-aware readiness classification (4 states)
- Priority-based selection (lower number = higher priority, then FIFO)
- Error-hold with prompted follow-up retry path
- Fire-and-forget session activity writes to Linear
- CLI-first invocation (no HTTP/webhook)
- Clean exit when backlog is drained

## Test Results

- **126 tests pass, 0 failures** across 9 test files
- **275 expect() calls** covering classification, selection, error-holds, task input, runner, activity writes, and summary shape
- `drain.test.ts` specifically covers the full integration: classification of all 4 states, priority selection, error-hold tracking, retry feedback, runner success/failure, and activity writes
- **TypeScript typecheck passes** with no errors

## Architecture Review

| Module | Purpose | Status |
|--------|---------|--------|
| `worker.ts` | Top-level drain loop with error-hold and retry | Implemented |
| `backlog.ts` | Deterministic selection (priority + FIFO) | Implemented |
| `readiness.ts` | Pure dependency-aware classification | Implemented |
| `runner.ts` | Single-issue blueprints invocation with activities | Implemented |
| `error-hold.ts` | In-memory failure tracking | Implemented |
| `cli.ts` | CLI entrypoint with run/dry-run/config | Implemented |
| `engine.ts` | Claude Agent SDK engine layer | Implemented |
| `linear/*` | Client, loader, sessions, issues, activities | Implemented |

## Non-goals confirmed absent
- No HTTP or webhook ingress
- No multi-worker scheduling
- No ralphe migration to blueprints
