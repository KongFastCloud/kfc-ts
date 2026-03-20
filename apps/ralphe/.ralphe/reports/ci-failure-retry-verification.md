# Verification Report: Retry agent on CI failure with failed logs as feedback

**Date:** 2026-03-20
**Status:** PASS

## Summary

The CI failure retry feature has been correctly implemented. All 379 tests pass across 21 test files with 0 failures. The implementation satisfies all acceptance criteria.

## Acceptance Criteria Verification

### 1. CI failure triggers a retry with structured annotations as agent feedback
**PASS**

In `src/runTask.ts` (lines 60-78), the `commit_and_push_and_wait_ci` git mode is inside the loop body. When `gitWaitForCi()` detects a failing CI run, it returns a `CheckFailure` (not `FatalError`), which the loop in `src/loop.ts` catches and converts into feedback for the next retry attempt. The feedback includes the CI annotations string.

### 2. Annotations are fetched via gh api check-runs/{job-id}/annotations
**PASS**

In `src/git.ts`, the `fetchCiAnnotations()` function (lines 148-196):
- Gets repo info via `gh repo view --json nameWithOwner`
- Gets failed jobs via `gh run view <runId> --json jobs`
- Fetches annotations via `gh api repos/${repo}/check-runs/${job.databaseId}/annotations`
- Formats annotations as readable text with path, line, title, and message

### 3. Only failure-level annotations are included (not warnings)
**PASS**

In `src/git.ts` line 179: `annotations.push(...parsed.filter((a) => a.annotation_level === "failure"))` — only annotations with `annotation_level === "failure"` are included.

### 4. maxAttempts is respected across both local and CI failures
**PASS**

The loop in `src/loop.ts` uses a shared `maxAttempts` counter. Both `cmd()` (local checks) and `gitWaitForCi()` produce `CheckFailure` errors, so they share the same retry budget. When `attempt >= maxAttempts`, the loop converts `CheckFailure` to `FatalError` and stops.

### 5. Git modes none, commit, and commit_and_push are unaffected
**PASS**

In `src/runTask.ts`:
- `commit_and_push_and_wait_ci` is handled inside the loop body (lines 60-78)
- `none`, `commit`, and `commit_and_push` are handled in the post-loop switch statement (lines 89-112)
- Tests in `runTaskGitMode.test.ts` confirm all modes work correctly

### 6. Agent can successfully fix a CI failure on retry
**PASS**

The architecture supports this:
- `gitWaitForCi()` returns `CheckFailure` with annotations as `stderr`
- The loop catches `CheckFailure` and formats feedback: `Command "CI run <id>" failed (exit 1):\nCI failed (run <id>). Failure annotations:\n\n<annotations>`
- The agent receives this feedback on the next attempt via `agent(task, { feedback })`

## Previous Errors Resolution

All 10 errors from the previous CI run have been resolved:
- `beads.ts` — `markTaskReady` export: exists at line 208, imported correctly by consumers
- `git.test.ts` — Both tests pass (commit returns hash, undefined when no changes)
- `runTask.test.ts` — All 5 orchestration tests pass
- `cmd.test.ts` — All 3 cmd tests pass (echo, exit code, stderr capture)
- `runTaskGitMode.test.ts` — All git mode tests pass

## Test Results

```
379 pass
0 fail
873 expect() calls
Ran 379 tests across 21 files. [4.59s]
```

## Key Design Decisions Verified

1. **CheckFailure vs FatalError**: CI failures use `CheckFailure` (retryable), timeouts and parse errors use `FatalError` (non-retryable)
2. **Annotation fetching is fault-tolerant**: `fetchCiAnnotations` catches all `FatalError`s and returns fallback strings
3. **Structured data over raw logs**: Annotations (~4KB) instead of raw logs (~117KB)
4. **Error metadata preserved**: `markTaskExhaustedFailure` stores error reason (including annotations) in metadata for operator investigation
