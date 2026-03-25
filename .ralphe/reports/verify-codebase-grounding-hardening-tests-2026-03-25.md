# Verification Report: Harden Codebase Grounding with Orchestration and Failure-Path Tests

**Date:** 2026-03-25
**Status:** PASS
**Test file:** `apps/seer/src/codebase-grounding.test.ts` (844 lines, 29 tests across 6 suites)

## Test Results

All 29 tests pass. Full suite runs in ~18 seconds. No failures, cancellations, or skips.

Additionally, the full `seer` test suite (109 tests across 27 suites) passes with 0 failures.

## Acceptance Criteria Verification

### 1. Startup sync and initial reindex behavior — PASS
- **Suite: "startup orchestration"** (4 tests): Verifies happy-path completion, sync failure not preventing reindex, reindex failure not preventing server start, and sequential ordering (sync before reindex).
- **Suite: "startup sync with real git repo"** (2 tests): Creates actual bare git repos, clones, pushes updates, and verifies `syncTrackedBranch` brings local checkout up to date. Also verifies `reindex` completes on a real directory.

### 2. Webhook-triggered background reindex behavior — PASS
- **Suite: "webhook → worker integration"** (4 tests): Verifies tracked-branch push triggers background worker, webhook returns immediately (<1s) without blocking on indexing, non-tracked branch is ignored with `branch_mismatch` reason, and non-push events are ignored.

### 3. Repeated update coalescing and stale-index tolerance — PASS
- **Suite: "coalescing and stale-index tolerance"** (3 tests): Fires 3 rapid webhooks in parallel and confirms coalescing (worker handles without crash), sends 4 direct `requestReindex` signals during active run and confirms coalescing, and verifies `readFileTool` remains functional during active background reindex (stale-index tolerance).

### 4. Grounded answer flow using codemogger plus direct file verification — PASS
- **Suite: "grounded answer flow — file-read verification"** (5 tests): Creates temp files simulating codemogger search results, verifies agent can read full files with line numbers, read specific line ranges, follow imports across files, get clear errors for missing files (stale index), and get formatted line numbers for precise code reference.

### 5. Failure logging and graceful behavior — PASS
- **Suite: "failure logging and graceful degradation"** (11 tests): Covers sync failure on non-existent directory, sync failure on invalid branch, reindex against nonexistent directory completing without crash, worker surviving sync+reindex failures and remaining responsive, worker surviving repeated failures, malformed JSON webhook returning 200 gracefully, missing ref field webhook returning 200 gracefully, tag ref (non-branch) being ignored, requestReindex before worker init being a safe no-op, path traversal security boundary, and config defaults when env vars are unset.

## Architecture Notes

- Tests use `node:test` native test runner with `node:assert/strict`.
- Environment isolation via `withEnv` helper preserves/restores process.env.
- Real git repos created in temp dirs for sync tests; cleaned up in `after()`.
- Effect fibers are properly interrupted in `finally` blocks.
- Worker state reset between tests via `_resetForTest()`.
- No new product behavior introduced — tests only verify existing orchestration boundaries.

## Log Output Observations

Test logs confirm proper structured logging (logfmt format) for:
- Reindex worker lifecycle (start, signal, coalescing, completion)
- Git sync failures with descriptive error messages
- Codemogger reindex output (file/chunk counts)
- Webhook parsing warnings (malformed JSON, missing fields)
