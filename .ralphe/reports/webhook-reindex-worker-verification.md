# Verification Report: Webhook-Triggered Background Reindex Worker

**Date:** 2026-03-25
**Status:** PASS

## Summary

The webhook-triggered background reindex worker for tracked-branch updates has been correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Webhook endpoint exists for tracked-branch update events
**PASS** — `POST /webhook/branch-update` route registered in `handler.ts` (line 44). The handler in `adapters/webhook.ts` supports GitHub push events, GitLab Push Hook events, and a generic fallback with `ref` field parsing.

### 2. Webhook returns quickly without blocking on sync or reindex
**PASS** — `handleBranchUpdateWebhook()` calls `requestReindex()` which only sets a Deferred signal or a boolean flag. The actual sync/reindex runs on a separate daemon fiber. The webhook always returns HTTP 200 immediately.

### 3. Background sync and reindex run in-process via Effect-based orchestration
**PASS** — `reindex-worker.ts` implements an Effect-native worker loop using `Deferred`, `Ref`, and `Effect.forever`. The worker is forked as a daemon fiber at boot in `index.ts` (line 72). It calls `syncTrackedBranch()` then `reindex()` with best-effort error handling.

### 4. Repeated updates are coalesced with simple in-memory logic
**PASS** — When the worker is already running (`Deferred.isDone` returns true), `requestReindex()` sets `pendingRef` to `true` instead of queuing another run. After a run completes, the worker checks the flag and does at most one follow-up run. Multiple signals during execution collapse into a single re-run. Test "repeated requests during a run are coalesced" confirms this (sends 3 signals, worker runs exactly 2 times).

### 5. Chat remains available while background reindexing is running
**PASS** — The worker runs on its own fiber, independent of the HTTP server. The server continues to handle requests on the main event loop. No shared locks or blocking between chat and reindex paths.

## Test Results

### Unit Tests (reindex-worker.test.ts) — 4/4 PASS
- `requestReindex before initialisation does not throw`
- `worker initialises when the loop starts`
- `requestReindex signals the worker without throwing`
- `repeated requests during a run are coalesced`

### Integration Tests (webhook.test.ts) — 9/9 PASS
- GitHub push to tracked branch → `reindex_requested`
- GitHub push to non-tracked branch → ignored (branch_mismatch)
- GitHub non-push event → ignored
- GitLab Push Hook for tracked branch → `reindex_requested`
- GitLab non-push event → ignored
- Generic ref payload for tracked branch → `reindex_requested`
- Invalid JSON body → 200 with ignored
- Empty body → 200 with ignored
- Payload without ref field → ignored

### TypeScript Compilation
Clean — no type errors.

## Key Files

| File | Role |
|------|------|
| `apps/repochat/src/reindex-worker.ts` | Background worker with coalescing logic |
| `apps/repochat/src/adapters/webhook.ts` | Webhook handler with multi-provider parsing |
| `apps/repochat/src/handler.ts` | Route registration for `/webhook/branch-update` |
| `apps/repochat/src/index.ts` | Worker fiber startup at boot |
| `apps/repochat/src/startup/git-sync.ts` | Git sync primitive (shared with startup) |
| `apps/repochat/src/startup/reindex.ts` | Codemogger reindex primitive (shared with startup) |
| `apps/repochat/src/config.ts` | Environment-based configuration |

## Design Notes

- Single-process, in-memory design as specified (no durable queues or separate workers)
- Effect library provides structured concurrency via fibers
- Deferred + Ref pattern is elegant and avoids complex queue machinery
- Failures are logged but don't crash the worker (best-effort philosophy)
- Module-level state with test reset helper for clean test isolation
