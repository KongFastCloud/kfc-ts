# Check/CI Failure + Success Comment Logging - Verification Report

**Date:** 2026-03-20
**Status:** PASS

## Summary

Verified that check failure, CI failure, and success events from `loop.ts` are correctly wired into beads comments via the `onEvent` callback in `runTask.ts`.

## Acceptance Criteria Verification

### 1. On check failure with retries remaining, a comment is written with the feedback string
**PASS** - In `loop.ts` lines 61-67, when a `CheckFailure` is caught and `attempt < maxAttempts`, `onEvent` is called with `type: "check_failed"` and the feedback string. In `runTask.ts` lines 198-200, the `onEvent` callback handles `check_failed` by calling `addComment(issueId, comment)`.

### 2. On CI failure with retries remaining, a comment is written with CI annotations
**PASS** - CI failures produce `CheckFailure` with command like `"CI run 12345"` and stderr containing annotations. These flow through the same `check_failed` path in `loop.ts` — no special handling needed. Verified by test `onEvent check_failed includes CI stderr in feedback` (loop.test.ts line 161).

### 3. On success (all checks passed), a comment is written
**PASS** - In `loop.ts` line 48, after successful `fn` completion, `emitEvent({ type: "success", ... })` is called via `Effect.tap`. In `runTask.ts` lines 202-204, the `onEvent` callback handles `success` by formatting and calling `addComment`.

### 4. Comment text matches format: `[attempt N/M] check failed — <feedback>`
**PASS** - `formatCheckFailedComment` (runTask.ts lines 127-132) produces exactly this format. Verified by unit tests (runTask.test.ts lines 150-161).

### 5. Comment text matches format: `[attempt N/M] all checks passed`
**PASS** - `formatSuccessComment` (runTask.ts lines 137-141) produces exactly this format. Verified by unit tests (runTask.test.ts lines 163-173).

### 6. No comments are written when issueId is absent (direct CLI run)
**PASS** - In `runTask.ts` line 196, `if (!issueId) return Effect.void` — early return skips all comment writes when no issueId is provided.

### 7. Unit tests verify onEvent is called with check_failed and success types
**PASS** - `loop.test.ts` contains dedicated tests:
- `onEvent fires attempt_start and success events` (line 110)
- `onEvent fires attempt_start and check_failed for each retry` (line 130)
- `onEvent check_failed includes CI stderr in feedback` (line 161)
- `onEvent check_failed is not emitted on final attempt` (line 194)

## Test Results

All 22 tests across 2 test files pass:
- `apps/ralphe/tests/loop.test.ts` - 9 tests pass
- `apps/ralphe/tests/runTask.test.ts` - 13 tests pass

## Implementation Details

- **Fire-and-forget pattern**: `addComment` in `beads.ts` catches `FatalError` and logs a warning instead of propagating (lines 362-364).
- **Event types**: `LoopEventType = "attempt_start" | "check_failed" | "success"` with `LoopEvent` interface carrying attempt, maxAttempts, and optional feedback.
- **Feedback string construction**: Built in `loop.ts` line 61: `Command "${err.command}" failed (exit ${err.exitCode}):\n${err.stderr}`.
