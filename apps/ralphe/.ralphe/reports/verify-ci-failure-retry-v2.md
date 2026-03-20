# Verification Report: Retry agent on CI failure with failed logs as feedback

**Date:** 2026-03-20
**Status:** PASS

## Summary

All acceptance criteria for the CI failure retry feature are correctly implemented. All 379 tests pass across 21 test files with 0 failures.

## Acceptance Criteria Verification

### 1. CI failure triggers a retry with structured annotations as agent feedback
**PASS**

In `src/runTask.ts` (lines 140-142), the `commit_and_push_and_wait_ci` git mode is handled inside the retry loop via `buildCiGitStep(ops)`. This means CI failures (returned as `CheckFailure`) are caught by the `loop()` function in `src/loop.ts`, which retries with the error's stderr as feedback to the agent.

The `buildCiGitStep()` function (lines 48-63) chains commit → push → waitCi sequentially. When `waitCi` fails with `CheckFailure`, the loop catches it and passes annotations as feedback.

### 2. Annotations are fetched via gh api check-runs/{job-id}/annotations
**PASS**

In `src/git.ts`, the `fetchCiAnnotations()` function (lines 148-196):
- Gets failed jobs via `gh run view <runId> --json jobs`
- Fetches annotations via `gh api repos/{repo}/check-runs/{job.databaseId}/annotations`
- This is exactly the check-runs API endpoint specified in the design

### 3. Only failure-level annotations are included (not warnings)
**PASS**

In `src/git.ts` line 179: `annotations.push(...parsed.filter((a) => a.annotation_level === "failure"))`

Only annotations with `annotation_level === "failure"` are included. Warnings, notices, and other levels are filtered out.

### 4. maxAttempts is respected across both local and CI failures
**PASS**

In `src/runTask.ts`, the `loop()` call (lines 126-146) wraps both local checks (`cmd(check)`) and the CI git step (`buildCiGitStep(ops)`) in the same loop body. The `maxAttempts: config.maxAttempts` parameter applies to both. The `loop()` function in `src/loop.ts` tracks attempts and converts `CheckFailure` to `FatalError` when `state.attempt >= maxAttempts`.

### 5. Git modes none, commit, and commit_and_push are unaffected
**PASS**

In `src/runTask.ts`:
- The CI step is only added to the loop when `gitMode === "commit_and_push_and_wait_ci"` (line 140)
- `executePostLoopGitOps()` (lines 71-101) handles `none`, `commit`, and `commit_and_push` modes in the post-loop section
- For `commit_and_push_and_wait_ci`, `executePostLoopGitOps` is a no-op (line 79)

Test file `tests/runTaskGitMode.test.ts` explicitly verifies:
- `none` mode executes no git operations
- `commit` mode executes commit only
- `commit_and_push` executes commit then push
- `commit_and_push_and_wait_ci` runs commit/push/wait_ci via `buildCiGitStep`, and post-loop is no-op

### 6. Agent can successfully fix a CI failure on retry
**PASS**

The architecture supports this:
- `gitWaitForCi()` returns `CheckFailure` (not `FatalError`) on CI failure (line 320-325 of git.ts)
- The `CheckFailure` stderr contains structured annotations formatted as readable text
- The `loop()` function catches `CheckFailure` and passes the feedback string to the next agent invocation
- The agent receives the CI failure annotations and can use them to fix the issue

## Previous CI Errors - Resolution

All 10 previously failing test assertions now pass:
- `git.test.ts` - gitCommit returns undefined when no changes, commit message in log
- `runTask.test.ts` - resume token capture, fatal error propagation, attempt counts
- `cmd.test.ts` - echo output, CheckFailure on non-zero exit
- `beads.ts` - markTaskReady export is properly defined

## Test Results

```
379 pass
0 fail
867 expect() calls
Ran 379 tests across 21 files. [4.37s]
```

## Key Implementation Details

- **Error type conversion**: `gitWaitForCi` returns `CheckFailure` for CI failures (retryable) and `FatalError` for infrastructure issues (non-retryable)
- **Annotation format**: Structured as `- path:line — title: message` (~4KB vs ~117KB raw logs)
- **Dependency injection**: `GitOps` interface enables testability without module mocking
- **Graceful degradation**: `fetchCiAnnotations` catches all errors and returns fallback strings
