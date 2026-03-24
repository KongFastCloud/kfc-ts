# Verification Report: Align Ralphe Milestone Logs for Remote Observability

**Date:** 2026-03-24
**Status:** PASS

## Summary

Verified that ralphe's log call sites are aligned with the PRD requirements for remote observability. The remote-eligible log stream includes all required milestone events, noisy polling logs remain debug-only (local), the stream tells a coherent workflow lifecycle story, and no workflow behavior was altered.

## Acceptance Criteria Verification

### 1. Remote-eligible log stream includes all required milestones

Checked each milestone category against actual log call sites:

| Milestone Category | Log Sites | Level | File |
|---|---|---|---|
| **Watcher lifecycle** | `Beads watcher starting`, `Beads watcher stopped`, `Recovered N stale task(s)`, `Worktree has uncommitted changes`, `Worktree is clean`, `Reached task limit` | Info/Warning | `watcher.ts` |
| **Task discovery & claim** | `Found ready task: {id}`, `Claimed task: {id}`, `Task {id} already claimed by another worker` | Info | `watchWorkflow.ts` |
| **Attempt start** | `Attempt {n}/{max}`, `Retrying with feedback from previous failure` | Info | `loop.ts` |
| **Agent start & completion** | `Running agent...`, `Agent done.` | Info | `agent.ts` |
| **Check pass & failure** | `Check passed.`, `Check failed: "{cmd}" exited {code}. Will retry.` | Info/Warning | `cmd.ts`, `loop.ts` |
| **Verification lifecycle** | `Running verification ({mode})...`, `Verification passed.`, `Verification failed: {report}` | Info/Warning | `report.ts` |
| **Git milestones** | `No changes to commit.`, `Committed.`, `Pushed.`, `Commit hash: {hash}`, `Pushed: {remote}/{ref}` | Info | `git.ts`, `runTask.ts` |
| **CI milestones** | `Waiting for GitHub Actions for commit {sha}...`, `CI succeeded across {n} run(s).`, `CI failed: run {id} concluded "{conclusion}".`, `CI passed: run {id}` | Info/Warning | `git.ts`, `runTask.ts` |
| **Task completion** | `Task completed successfully.` | Info | `watchWorkflow.ts` |
| **Exhausted retries** | `Task exhausted all retries — marked as error (task remains open).` | Warning | `watchWorkflow.ts` |
| **Task failure** | `Task failed: {message}` | Error | `runTask.ts` |

**Result: All 11 milestone categories from the PRD are covered.**

### 2. Noisy polling-style debug logs remain local-only

Debug-level logs found in the codebase (9 total):

| Message Pattern | File | Purpose |
|---|---|---|
| `Generating commit message...` | `git.ts` | Interim progress |
| `Commit message: {msg}` | `git.ts` | Detailed output |
| `Pushing...` | `git.ts` | Interim progress |
| `No CI run found yet for {sha}; retrying in 10s...` | `git.ts` | Polling heartbeat |
| `CI in progress ({n}/{total} still running). Checking again in 10s...` | `git.ts` | Polling heartbeat |
| `Running: {command}` | `cmd.ts` | Command detail |
| `Passed: {command}` | `cmd.ts` | Verbose detail |
| `Resume this Claude session with: claude --resume {id}` | `ClaudeEngine.ts` | Session token |
| `Resume this Codex session with: codex resume {id}` | `CodexEngine.ts` | Session token |

The remote logger (`remoteLogger.ts` line 43-45) explicitly filters these out:
```typescript
const isRemoteEligible = (level: LogLevel.LogLevel): boolean =>
  level._tag === "Info" || level._tag === "Warning" || level._tag === "Error" || level._tag === "Fatal"
```

CI polling logs (`No CI run found yet`, `CI in progress`) and command execution details (`Running:`, `Passed:`) are correctly at Debug level and will never be shipped remotely.

**Result: PASS — All polling/heartbeat logs are Debug-level, filtered by the remote logger.**

### 3. Remote log stream enables progress monitoring

The remote stream tells a coherent lifecycle story for any ralphe run:

1. **Watcher start** → `Beads watcher starting` (with `workerId` annotation)
2. **Task discovery** → `Found ready task: {id}`
3. **Task claim** → `Claimed task: {id}` (with `taskId`, `issueTitle` annotations)
4. **Attempt start** → `Attempt 1/2` (with `attempt`, `maxAttempts` annotations)
5. **Agent execution** → `Running agent...` → `Agent done.`
6. **Check results** → `Check passed.` or `Check failed: ... Will retry.`
7. **Verification** → `Running verification...` → `Verification passed.` or `Verification failed:`
8. **Git** → `Committed.` → `Pushed: origin/main`
9. **CI** → `Waiting for GitHub Actions...` → `CI succeeded across N run(s).`
10. **Completion** → `Task completed successfully.` or `Task exhausted all retries`
11. **Watcher stop** → `Beads watcher stopped.`

Structured annotations flow through the pipeline:
- `workerId` via `watcher.ts` `Effect.annotateLogs({ workerId })`
- `taskId`, `issueTitle` via `watchWorkflow.ts` `Effect.annotateLogs({ taskId, issueTitle })`
- `attempt`, `maxAttempts` via `loop.ts` `Effect.annotateLogs({ attempt, maxAttempts })`
- `engine`, `gitMode` via `runTask.ts` `Effect.annotateLogs({ gitMode, engine })`
- `check.name` via `runTask.ts` `Effect.annotateLogs({ "check.name": check })`

The remote logger maps these to canonical remote field names (e.g., `taskId` → `issue.id`, `attempt` → `loop.attempt`).

**Result: PASS — An operator can reconstruct the full workflow lifecycle from the remote stream.**

### 4. Log-site changes do not alter workflow behavior

- All logging uses `Effect.logInfo`, `Effect.logDebug`, `Effect.logWarning`, `Effect.logError` — pure side-effect-free log statements
- No control flow depends on logging outcomes
- The remote logger is fail-open: missing config → no-op, network errors → `console.error` only
- All 599 tests pass with 0 failures, confirming no behavioral regressions

**Result: PASS — Logging is observational only, no workflow behavior changes.**

## Test Results

```
599 pass, 0 fail, 1375 expect() calls
Ran 599 tests across 31 files. [6.45s]
```

Key test files covering this slice:
- `remoteLogger.test.ts` — 18 tests: level filtering, field allowlist, fail-open, AppLoggerLayer/TuiLoggerLayer integration
- `logger.test.ts` — 3 tests: file + stderr routing, TUI stderr suppression
- `watchWorkflow.test.ts` — Tests verify milestone logs appear at correct levels with annotations
- `loop.test.ts` — Tests verify attempt/retry logs
- `runTask.test.ts` — Tests verify git/CI milestone logs
- `spanHierarchy.test.ts` — Tests verify the full pipeline log sequence

## Architecture Summary

The logger stack is:
- **AppLoggerLayer**: stderr (logfmt) + file (JSON lines) + remote (Axiom)
- **TuiLoggerLayer**: file (JSON lines) + remote (Axiom) — no stderr

Remote shipping (`remoteLogger.ts`):
- Only ships Info, Warning, Error, Fatal levels
- Field allowlist: `issue.id`, `engine`, `check.name`, `trace_id`, `span_id`, `workerId`, `loop.attempt`, `loop.max_attempts`
- Buffers up to 50 entries, flushes every 5s or on buffer full
- Fail-open: missing config/network errors never block execution

## Conclusion

All four acceptance criteria are met. The remote-eligible log stream covers every milestone category required by the PRD, polling noise stays local-only, the lifecycle narrative is operationally complete, and no workflow behavior was changed.
