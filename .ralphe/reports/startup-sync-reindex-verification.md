# Verification Report: Startup Sync and Initial Reindex for Tracked Branch

**Date:** 2026-03-25
**Status:** PASS

## Summary

The startup sync and initial codemogger reindex feature for the configured tracked branch has been correctly implemented.

## Acceptance Criteria Verification

### 1. Seer can sync a configurable tracked branch on startup — PASS
- `apps/seer/src/config.ts` exposes `trackedBranch()` which reads from `SEER_TRACKED_BRANCH` env var, defaulting to `"main"`.
- `apps/seer/src/startup/git-sync.ts` implements `syncTrackedBranch(repoRoot, branch)` using fetch → checkout → hard reset strategy.
- `apps/seer/src/startup/index.ts` orchestrates calling sync before the server starts.
- `apps/seer/src/index.ts` calls `runStartupTasks()` at line 60, before `server.listen()`.

### 2. Seer attempts an initial codemogger reindex on startup — PASS
- `apps/seer/src/startup/reindex.ts` implements `reindex(repoRoot, dbPath)` using `npx -y codemogger index`.
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
- `trackedBranch()` reads `SEER_TRACKED_BRANCH` env var, defaulting to `"main"`.
- `repoRoot()` reads `SEER_REPO_ROOT` env var, defaulting to `process.cwd()`.
- `codemoggerDbPath()` reads `CODEMOGGER_DB_PATH` env var (optional).

## Test Results

All 76 tests pass (0 failures):
- `startup.test.ts`: Best-effort orchestration (completes without throwing on failure)
- `git-sync.test.ts`: Real git operations (sync to remote, graceful failure on bad branch/dir)
- `reindex.test.ts`: Wrapper behavior (empty dir, optional dbPath)

## Files Reviewed

| File | Purpose |
|------|---------|
| `apps/seer/src/config.ts` | Configuration (tracked branch, repo root, db path) |
| `apps/seer/src/startup/index.ts` | Startup orchestration |
| `apps/seer/src/startup/git-sync.ts` | Git fetch/checkout/reset sync |
| `apps/seer/src/startup/reindex.ts` | Codemogger reindex wrapper |
| `apps/seer/src/index.ts` | Server entry point (calls runStartupTasks) |
| `apps/seer/src/startup/startup.test.ts` | Orchestration tests |
| `apps/seer/src/startup/git-sync.test.ts` | Git sync tests |
| `apps/seer/src/startup/reindex.test.ts` | Reindex tests |

## Design Notes

- Uses Effect library for structured error handling and logging.
- No separate worker processes or durable job infrastructure (per spec).
- Bot-owned checkout uses `git reset --hard` intentionally — not a dev workspace.
- 60s timeout for git operations, 5-minute timeout for codemogger reindex.
