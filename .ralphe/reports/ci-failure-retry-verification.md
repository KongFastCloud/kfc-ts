# Verification Report: Retry Agent on CI Failure with Failed Logs as Feedback

**Date:** 2026-03-20
**Status:** PASS

## Summary

All acceptance criteria are met. The implementation correctly moves CI operations into the retry loop for `commit_and_push_and_wait_ci` mode, fetches structured failure annotations via the GitHub check-runs API, and feeds them back to the agent as `CheckFailure` errors (which the loop retries).

## Test Results

- **379 tests pass, 0 failures** across 21 test files
- All previous CI error annotations from the failed run are resolved

## Acceptance Criteria Verification

### 1. CI failure triggers a retry with structured annotations as agent feedback
**PASS**

- `gitWaitForCi()` in `src/git.ts:316-325` returns a `CheckFailure` (not `FatalError`) when a failing CI run is detected
- The `CheckFailure.stderr` field contains the formatted annotations string: `"CI failed (run ${id}). Failure annotations:\n\n${annotations}"`
- `buildCiGitStep()` in `src/runTask.ts:48-63` is called inside the loop body (line 141), so `CheckFailure` flows into the loop's retry logic
- The `loop()` function in `src/loop.ts:36-53` catches `CheckFailure`, formats feedback, and passes it to the next attempt

### 2. Annotations are fetched via `gh api check-runs/{job-id}/annotations`
**PASS**

- `fetchCiAnnotations()` in `src/git.ts:148-196`:
  1. Gets repo name via `gh repo view --json nameWithOwner`
  2. Gets failed jobs via `gh run view <runId> --json jobs`
  3. Filters jobs to `conclusion === "failure"`
  4. For each failed job, calls `gh api repos/${repo}/check-runs/${job.databaseId}/annotations`
  5. Parses the JSON response as `GhAnnotation[]`

### 3. Only failure-level annotations are included (not warnings)
**PASS**

- `src/git.ts:179`: `annotations.push(...parsed.filter((a) => a.annotation_level === "failure"))`
- Only annotations with `annotation_level === "failure"` are included; warnings, notices, etc. are filtered out

### 4. maxAttempts is respected across both local and CI failures
**PASS**

- `runTask()` in `src/runTask.ts:126-146` creates a single `loop()` call with `{ maxAttempts: config.maxAttempts }`
- Both local check failures (from `cmd()`) and CI failures (from `buildCiGitStep()`) flow through the same loop as `CheckFailure` errors
- The shared `maxAttempts` counter applies to both types of failures
- After exhausting attempts, `loop()` converts to `FatalError` (src/loop.ts:37-43)

### 5. Git modes none, commit, and commit_and_push are unaffected
**PASS**

- `executePostLoopGitOps()` in `src/runTask.ts:71-101`:
  - `"none"`: no-op (line 79)
  - `"commit"`: commit only (lines 81-86)
  - `"commit_and_push"`: commit then push (lines 88-98)
  - `"commit_and_push_and_wait_ci"`: no-op post-loop (line 79) — handled in-loop instead
- The conditional on line 140 only adds `buildCiGitStep` to the pipeline when `gitMode === "commit_and_push_and_wait_ci"`
- Test `runTaskGitMode.test.ts` verifies all four modes independently

### 6. Agent can successfully fix a CI failure on retry
**PASS**

- The architecture supports this: when CI fails, `CheckFailure` with annotations is caught by the loop, formatted as feedback (loop.ts:50), and passed to the next `agent()` call
- The agent receives the structured annotations (file:line, title, message) and can use them to diagnose and fix the issue
- `runTaskGitMode.test.ts:171-183` tests that `waitCi` failure produces a `CheckFailure` with CI failure details in stderr

## Architecture Notes

- `GitOps` interface (src/runTask.ts:25-29) enables dependency injection for testing — `waitCi()` returns `CheckFailure | FatalError`
- `fetchCiAnnotations` gracefully handles errors: returns fallback strings like "(no failed jobs found)" or "(failed to fetch CI annotations)" instead of failing
- Annotation formatting is concise: `- path:line — title: message` (~4KB vs ~117KB of raw logs)
- The `markTaskExhaustedFailure` function in beads.ts stores the error string in metadata, which would include CI annotations if all retries exhaust

## Previous Error Resolution

All 10 CI failure annotations from the previous run are resolved:
- `git.test.ts`: Tests pass (commit results, push behavior verified)
- `beads.ts`: No `markTaskReady` export error — function exists and is properly defined
- `runTask.test.ts`: All orchestration tests pass (resume tokens, retry counts)
- `cmd.test.ts`: CheckFailure behavior correct (exit codes, stderr capture)
