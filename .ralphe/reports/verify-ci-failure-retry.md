# Verification Report: CI Failure Retry

**Date:** 2026-03-20
**Feature:** Retry agent on CI failure with failed logs as feedback
**Status:** PASS

## Acceptance Criteria Verification

### 1. CI failure triggers a retry with failed logs included as agent feedback
**PASS** - `gitWaitForCi()` in `src/git.ts` now returns `CheckFailure` (not `FatalError`) when a CI run fails. The loop in `src/loop.ts` catches `CheckFailure` and passes its `stderr` field as feedback to the next agent invocation. The `commit_and_push_and_wait_ci` pipeline is inside the loop body (lines 60-79 of `runTask.ts`), so failures are retried.

### 2. maxAttempts is respected across both local and CI failures
**PASS** - Both local check failures (from `cmd()`) and CI failures (from `gitWaitForCi()`) produce `CheckFailure` errors. The `loop()` function handles them uniformly, converting to `FatalError` when `state.attempt >= maxAttempts`. The shared `maxAttempts` from config covers all retry scenarios.

### 3. gh run view --log-failed output is captured and passed to agent
**PASS** - In `git.ts` lines 248-264, when a failing run is detected:
- `gh run view <runId> --log-failed` is executed via `runGh()`
- Output is captured as `failedLogs`
- If fetching logs fails, a fallback message "(failed to fetch CI logs)" is used
- The logs are embedded in the `CheckFailure.stderr` field: `"CI failed for run <id> (conclusion: <conclusion>).\n\n<failedLogs>"`
- The loop passes this as feedback to the agent via `agent(task, { feedback })`

### 4. Git modes none, commit, and commit_and_push are unaffected
**PASS** - In `runTask.ts`:
- `none`, `commit`, and `commit_and_push` modes are handled in the post-loop switch statement (lines 89-112)
- `commit_and_push_and_wait_ci` has a `break` in the switch (line 92), doing nothing post-loop
- Only `commit_and_push_and_wait_ci` is inside the loop body
- Tests confirm: `none` = no git calls, `commit` = commit only, `commit_and_push` = commit + push

### 5. Agent can successfully fix a CI failure on retry
**PASS** - The architecture supports this end-to-end:
1. CI fails -> `CheckFailure` with logs
2. Loop catches `CheckFailure`, increments attempt, sets feedback
3. Agent receives feedback containing CI failure logs
4. Agent produces new code changes
5. New commit/push/CI-wait cycle runs
6. If CI passes, loop exits successfully

## Test Results

All 24 tests pass across 4 test files:
- `runTaskGitMode.test.ts` - 10 tests covering all git modes and failure scenarios
- `loop.test.ts` - 4 tests covering retry logic
- `runTask.test.ts` - 5 tests covering pipeline composition
- `git.test.ts` - 5 tests covering git operations

Key test cases for this feature:
- `commit_and_push_and_wait_ci executes commit then push then wait_ci` - happy path
- `commit_and_push_and_wait_ci skips push and wait when no commit is created` - no-op case
- `run fails when wait_ci fails` - CI failure surfaces correctly
- `wait_ci is not attempted when push fails` - push failure stops pipeline

## Type Check

`bun run --filter ralphe typecheck` passes with no errors. The `gitWaitForCi` signature correctly declares `Effect.Effect<GitHubCiResult, FatalError | CheckFailure>`, matching the loop's expected error type.

## Implementation Summary

| File | Change |
|------|--------|
| `src/git.ts` | `gitWaitForCi` fetches `--log-failed` logs and returns `CheckFailure` instead of `FatalError` on CI failure |
| `src/runTask.ts` | `commit_and_push_and_wait_ci` pipeline moved inside the loop body; post-loop switch has `break` for this mode |
| `tests/runTaskGitMode.test.ts` | Mock `gitWaitForCi` returns `CheckFailure`; tests cover CI success, failure, and skip scenarios |
