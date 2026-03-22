# Verification Report: Make watchWorkflow the Canonical Lifecycle Suite

**Date:** 2026-03-22
**Status:** ✅ PASS

## Summary

The `watchWorkflow.test.ts` file has been successfully established as the canonical lifecycle contract for watch-task processing. All 20 tests pass (84 assertions) and the suite explicitly covers all six required contract areas.

## Test Execution

```
bun test apps/ralphe/tests/watchWorkflow.test.ts
20 pass, 0 fail, 84 expect() calls
Ran 20 tests across 1 file. [212.00ms]
```

## Acceptance Criteria Verification

### ✅ Shared workflow tests explicitly cover all required contracts

| # | Contract | Describe Block | Tests |
|---|----------|---------------|-------|
| 1 | Success lifecycle | `processClaimedTask: success lifecycle` | 2 tests — operation ordering, metadata writes, close, issueId forwarding |
| 2 | Failure lifecycle | `processClaimedTask: failure lifecycle` | 4 tests — exhausted-failure marking, no close, default reason, error metadata |
| 3 | Metadata timing | `processClaimedTask: metadata timing` | 2 tests — startedAt/finishedAt semantics for success and failure |
| 4 | Previous-error prompt | `processClaimedTask: previous error propagation` | 4 tests — inclusion, omission, no-error metadata, read-before-write ordering |
| 5 | Poll outcomes | `pollClaimAndProcess: poll outcomes` | 4 tests — NoneReady, ClaimContention, Processed success, Processed failure |
| 6 | Operation ordering | `pollClaimAndProcess: operation ordering` | 2 tests — success path sequence, failure path sequence |
| — | Prompt building | `pollClaimAndProcess: prompt building` | 2 tests — title/description, previous error in poll path |

### ✅ Suite reads as the canonical task lifecycle contract

- File header (lines 1–16) explicitly declares ownership of all six contracts with a clear comment stating higher-layer tests should NOT re-prove these behaviors.
- Each `describe` block is labeled with its contract number (e.g., "Contract 1: success lifecycle").
- The test names are descriptive and read as behavioral specifications.
- The suite uses configurable stubs and call-tracking arrays to verify operation ordering deterministically.

### ✅ No product behavior changes introduced

- The source file `watchWorkflow.ts` contains only the existing `processClaimedTask` and `pollClaimAndProcess` functions.
- The test suite only exercises existing behavior paths — success close, exhausted failure, metadata timing, previous-error propagation, poll discrimination.
- No new exports, types, or behavioral branches were added to the production code.

## Architecture Alignment

The implementation aligns with the PRD (`prd/ralphe-test-suite-rationalization.md`):
- Shared workflow tests are the canonical place for watch-task lifecycle behavior (PRD Implementation Decision #1).
- The `WatchWorkflowDeps` interface enables clean dependency injection for deterministic testing without ambient environment coupling.
- The file establishes a clear ownership boundary that higher-layer tests (worker, controller) can reference to avoid redundant assertions.
