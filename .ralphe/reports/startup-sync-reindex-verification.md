# Verification Report: Startup Sync and Initial Reindex for Tracked Branch

**Date:** 2026-03-25
**Status:** PASS

## Summary

The startup sync and initial codemogger reindex feature for the configured tracked branch has been correctly implemented.

## Acceptance Criteria Verification

### 1. Repochat can sync a configurable tracked branch on startup — PASS
- `apps/repochat/src/config.ts` exposes `trackedBranch()` which reads from `REPOCHAT_TRACKED_BRANCH` env var, defaulting to `"main"`.
- `apps/repochat/src/startup/git-sync.ts` implements `syncTrackedBranch(repoRoot, branch)` using fetch → checkout → hard reset strategy.
- `apps/repochat/src/startup/index.ts` orchestrates calling sync before the server starts.
- `apps/repochat/src/index.ts` calls `runStartupTasks()` at line 60, before `server.listen()`.

### 2. Repochat attempts an initial codemogger reindex on startup — PASS
- `apps/repochat/src/startup/reindex.ts` implements `reindex(repoRoot, dbPath)` using `npx -y codemogger index`.
- `runStartupTasks()` runs reindex after sync, before the server starts listening.

### 3. Startup sync and reindex failures are logged clearly — PASS
- Sync failures logged with: `"Startup git sync failed — continuing with existing checkout"` + error annotation.
- Reindex failures logged with: `"Startup codemogger reindex failed — index may be stale or empty"` + error annotation.
- Both use `Effect.logWarning` with `Effect.annotateLogs` for structured output via logfmt logger.

### 4. The server still starts when startup sync or reindex fails — PASS
- Both sync and reindex are wrapped with `Effect.catchAll(() => Effect.void)`, swallowing all errors.
- Sync failure does not prevent reindex from running.
- Reindex failure does not prevent server from starting.
- Test `startup.test.ts` explicitly verifies `runStartupTasks()` completes without throwing when both fail.

### 5. The tracked branch is configurable rather than hardcoded — PASS
- `trackedBranch()` reads `REPOCHAT_TRACKED_BRANCH` env var, defaulting to `"main"`.
- `repoRoot()` reads `REPOCHAT_REPO_ROOT` env var, defaulting to `process.cwd()`.
- `codemoggerDbPath()` reads `CODEMOGGER_DB_PATH` env var (optional).

## Test Results

All 76 tests pass (0 failures):
- `startup.test.ts`: Best-effort orchestration (completes without throwing on failure)
- `git-sync.test.ts`: Real git operations (sync to remote, graceful failure on bad branch/dir)
- `reindex.test.ts`: Wrapper behavior (empty dir, optional dbPath)

## Files Reviewed

| File | Purpose |
|------|---------|
| `apps/repochat/src/config.ts` | Configuration (tracked branch, repo root, db path) |
| `apps/repochat/src/startup/index.ts` | Startup orchestration |
| `apps/repochat/src/startup/git-sync.ts` | Git fetch/checkout/reset sync |
| `apps/repochat/src/startup/reindex.ts` | Codemogger reindex wrapper |
| `apps/repochat/src/index.ts` | Server entry point (calls runStartupTasks) |
| `apps/repochat/src/startup/startup.test.ts` | Orchestration tests |
| `apps/repochat/src/startup/git-sync.test.ts` | Git sync tests |
| `apps/repochat/src/startup/reindex.test.ts` | Reindex tests |

## Design Notes

- Uses Effect library for structured error handling and logging.
- No separate worker processes or durable job infrastructure (per spec).
- Bot-owned checkout uses `git reset --hard` intentionally — not a dev workspace.
- 60s timeout for git operations, 5-minute timeout for codemogger reindex.
