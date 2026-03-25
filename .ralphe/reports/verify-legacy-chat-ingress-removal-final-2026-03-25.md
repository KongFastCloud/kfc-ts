# Verification: Remove Legacy Custom Chat Ingress Primitives

**Date:** 2026-03-25
**Status:** PASS
**Commit:** 06af684 (docs), 2971e85 (key refactor)

## Acceptance Criteria Verification

### 1. Repochat no longer depends on a handwritten Google Chat payload schema
**PASS**

- No handwritten Google Chat payload schema exists anywhere in `apps/seer/`.
- Grep for `GoogleChatPayload`, `GoogleChatEvent`, `parseGoogleChat` returns zero results.
- All payload parsing is delegated to `@chat-adapter/gchat` (Vercel Chat SDK adapter).
- `handler.ts` routes `POST /google-chat/webhook` directly to `bot.webhooks.gchat(request)`.

### 2. Legacy custom Google Chat ingress code is removed or retired
**PASS**

- `apps/seer/src/adapters/google-chat.ts` (193 lines of handwritten ingress code) was **deleted** in commit `2971e85`.
- The `apps/repochat/` directory no longer exists (fully renamed to `apps/seer/`).
- The only Google Chat integration now goes through the SDK: `bot.ts` uses `Chat` from `"chat"` with `createGoogleChatAdapter()`.

### 3. Obsolete custom chat-ingress locking is removed
**PASS**

- `apps/seer/src/state.ts` (48 lines, custom thread locking) was **deleted** in commit `2971e85`.
- `apps/seer/src/state.test.ts` (97 lines) was **deleted** in the same commit.
- Grep for `ThreadLock`, `chatLock`, `acquireLock`, `releaseLock` returns zero results.
- Per-thread serialization is now handled entirely by the Chat SDK, as documented in `bot.ts` and `handler.ts` comments.

### 4. GitLab webhook and non-chat startup/indexing subsystems remain intact
**PASS**

- `apps/seer/src/adapters/webhook.ts` is fully intact with GitHub, GitLab, and generic push event support.
- `apps/seer/src/adapters/webhook.test.ts` tests pass.
- Startup git-sync and codemogger reindex subsystems (`startup/` directory) remain intact.
- Reindex worker with request coalescing remains intact.

## Test Results

- **114 tests pass, 0 failures** (`pnpm --filter seer test`)
- Test suites cover: bot message handler, chat reply generation, identity helpers, webhook integration, startup orchestration, reindex worker, memory persistence, MCP client config, product name consistency.

## Architecture Summary

The ingress path is now:

```
HTTP POST /google-chat/webhook
  → handler.ts (routes to SDK)
  → bot.webhooks.gchat(request) (SDK parses payload)
  → bot.onNewMention / bot.onSubscribedMessage (SDK dispatches)
  → handleIncomingMessage(thread, message) (SDK-normalised objects)
  → generateReply({ threadId, userId, text }) (Effect/Mastra pipeline)
  → thread.post(reply) (SDK posts back)
```

No custom schema parsing, no custom locking, no legacy adapter code remains in the active path.
