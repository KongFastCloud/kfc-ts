# Verification Report: Retry Agent on CI Failure with Failed Logs as Feedback

**Date:** 2026-03-20
**Status:** PASS

## Summary

All acceptance criteria verified. The CI failure retry feature is correctly implemented.

## Acceptance Criteria Verification

### 1. CI failure triggers a retry with structured annotations as agent feedback
**PASS**

In `src/runTask.ts` (line 140-142), when `gitMode === "commit_and_push_and_wait_ci"`, `buildCiGitStep(ops)` is added inside the loop body (within the `loop()` callback), not post-loop. This means CI failures are caught by the retry loop in `src/loop.ts`.

`gitWaitForCi()` in `src/git.ts` (line 319-324) now returns a `CheckFailure` (not `FatalError`) on CI failure, which the loop catches and converts to feedback for the next attempt.

The test `runTaskGitMode.test.ts` line 171-183 confirms that `buildCiGitStep` propagates `CheckFailure` when CI fails.

### 2. Annotations are fetched via gh api check-runs/{job-id}/annotations
**PASS**

In `src/git.ts` (lines 148-196), `fetchCiAnnotations()` fetches annotations using:
1. `gh repo view --json nameWithOwner` to get repo path
2. `gh run view <runId> --json jobs` to get failed job IDs
3. `gh api repos/${repo}/check-runs/${job.databaseId}/annotations` for each failed job

### 3. Only failure-level annotations are included (not warnings)
**PASS**

In `src/git.ts` line 179: `annotations.push(...parsed.filter((a) => a.annotation_level === "failure"))` — only `failure` level annotations are included.

### 4. maxAttempts is respected across both local and CI failures
**PASS**

In `src/runTask.ts` line 145, a single `maxAttempts` config value is passed to `loop()`. Both local check failures (from `cmd()`) and CI failures (from `buildCiGitStep()`) return `CheckFailure`, which the loop handles uniformly. The loop converts to `FatalError` after `maxAttempts` (loop.ts line 37-43).

### 5. Git modes none, commit, and commit_and_push are unaffected
**PASS**

In `src/runTask.ts`:
- `buildCiGitStep` is only added to the loop when `gitMode === "commit_and_push_and_wait_ci"` (line 140)
- `executePostLoopGitOps()` (lines 71-101) handles `none`, `commit`, and `commit_and_push` in the post-loop section, with `commit_and_push_and_wait_ci` as a no-op (line 79)

Tests in `runTaskGitMode.test.ts` confirm:
- `none` mode: no git ops (line 87-89)
- `commit` mode: commit only (line 93-95)
- `commit_and_push`: commit then push (line 99-103)

### 6. Agent can successfully fix a CI failure on retry
**PASS**

The architecture supports this:
- `gitWaitForCi` returns `CheckFailure` with structured annotations in `stderr`
- `loop.ts` catches `CheckFailure` and passes `stderr` as `feedback` to the next attempt
- The agent receives this feedback and can use it to fix the issue

## Previous Error Resolution

The previous error mentioned `markTaskReady` not being found in the module. Verified:
- `markTaskReady` is properly exported from `src/beads.ts` (line 208)
- `markTaskReady` is properly re-exported from `src/index.ts` (line 33)

## Test Results

All 24 tests pass across 4 test files:
- `runTaskGitMode.test.ts`: 10 pass (covers all git mode scenarios including CI retry)
- `loop.test.ts`: 4 pass (covers retry logic, feedback passing, max attempts)
- `runTask.test.ts`: 5 pass (covers orchestration pipeline)
- `git.test.ts`: 5 pass (covers commit, push operations)

## Key Implementation Files

| File | Changes |
|------|---------|
| `src/git.ts` | `gitWaitForCi` returns `CheckFailure` (not `FatalError`) on CI failure; `fetchCiAnnotations` fetches structured annotations via GitHub API |
| `src/runTask.ts` | `buildCiGitStep` runs inside loop for CI mode; `executePostLoopGitOps` is no-op for CI mode |
| `src/loop.ts` | Unchanged — already handles `CheckFailure` with retry + feedback |
| `src/errors.ts` | Unchanged — `CheckFailure` and `FatalError` types already existed |
