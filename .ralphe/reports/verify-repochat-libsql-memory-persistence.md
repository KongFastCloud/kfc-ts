# Verification: Persist repochat thread history and working memory with LibSQL

**Date:** 2026-03-25
**Status:** PASS

## Summary

Verified that repochat's thread history and working memory are persisted using a local LibSQL-backed storage backend via Mastra Memory. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Repochat uses an explicit local LibSQL-backed Mastra memory store — PASS

- `apps/repochat/src/memory.ts` creates a `Memory` instance with `storage` from `createLocalLibSQLStorage({ url: MEMORY_DB_URL })`
- `MEMORY_DB_URL` defaults to `file:./data/memory.db`, overridable via `REPOCHAT_MEMORY_DB_URL` env var
- The storage factory (`packages/mastra/src/storage/libsql.ts`) enforces `file:` URLs only, rejecting remote/in-memory URLs
- Parent directory is auto-created via `mkdirSync` with `{ recursive: true }`

### 2. Thread-local history persists across process restarts — PASS

- `MEMORY_CONFIG.lastMessages: 20` configures thread-scoped history
- Storage is backed by a LibSQL file on disk (`file:./data/memory.db`), which survives process restarts
- Thread identity uses platform-qualified IDs (e.g., `gchat:spaces/X/threads/Y`) passed via `memory.thread` in `chat.ts`

### 3. Resource-scoped working memory persists across process restarts — PASS

- `MEMORY_CONFIG.workingMemory` is `{ enabled: true, scope: "resource" }`
- Resource identity uses platform-qualified user IDs (e.g., `gchat:users/112233`) passed via `memory.resource` in `chat.ts`
- Same LibSQL file-backed storage ensures working memory survives restarts

### 4. Platform-qualified thread and resource identity behavior remains unchanged — PASS

- `apps/repochat/src/identity.ts` provides `qualifyThreadId()` and `qualifyUserId()` with format `<platform>:<raw-id>`
- Supports `gchat` and `discord` platforms
- Cross-platform isolation is natural: `gchat:users/123` ≠ `discord:users/123`
- 8 identity tests pass confirming isolation semantics

### 5. Repochat-specific memory composition remains in the app layer — PASS

- Memory config, working memory template, and storage wiring are all in `apps/repochat/src/memory.ts`
- The shared package (`@workspace/mastra`) only provides the generic `createLocalLibSQLStorage` factory
- Agent composition in `apps/repochat/src/agent.ts` imports memory from the app layer
- No memory policy exists in the shared package

## Test Results

- **repochat tests:** 51 passed, 0 failed (across 13 suites)
  - Memory config shape validation (6 tests)
  - Memory scoping semantics (4 tests)
  - Cross-platform isolation (2 tests)
  - Chat bridge memory wiring (11 tests)
  - Identity helpers (8 tests)
  - Thread locking (6 tests)
  - GlitchTip MCP (5 tests)
  - Error types (3 tests)
  - Memory instance existence (1 test)
- **@workspace/mastra tests:** 57 passed, 0 failed (across 8 suites)
  - LibSQL storage factory (6 tests)
- **Typecheck:** Clean for both repochat and @workspace/mastra

## Architecture Summary

```
Google Chat Adapter
  → qualifyThreadId("gchat", rawThreadId)
  → qualifyUserId("gchat", rawUserId)
  → generateReply({ threadId, userId, text })
      → agent.generate(text, { memory: { thread, resource } })
          → Memory({ storage: LibSQLStore("file:./data/memory.db"), options: MEMORY_CONFIG })
```

## Files Reviewed

| File | Role |
|------|------|
| `apps/repochat/src/memory.ts` | Memory config + LibSQL storage wiring |
| `apps/repochat/src/agent.ts` | Agent composition with memory |
| `apps/repochat/src/chat.ts` | Chat bridge passing thread/resource IDs |
| `apps/repochat/src/identity.ts` | Platform-qualified ID helpers |
| `packages/mastra/src/storage/libsql.ts` | Generic LibSQL storage factory |
