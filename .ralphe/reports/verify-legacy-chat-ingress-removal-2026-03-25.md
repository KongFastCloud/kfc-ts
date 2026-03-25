# Verification Report: Remove Legacy Custom Chat Ingress Primitives

**Date:** 2026-03-25
**Status:** PASS

## Summary

Verified that legacy custom Google Chat ingress code and custom thread-locking primitives have been fully removed, and the Vercel Chat SDK (`chat` v4.22.0) is the sole authoritative ingress boundary for Google Chat.

## Acceptance Criteria Verification

### 1. repochat no longer depends on a handwritten Google Chat payload schema — PASS

- No `GoogleChatEvent`, `GoogleChatMessage`, `GoogleChatUser`, `GoogleChatThread`, or `GoogleChatSpace` interfaces exist anywhere in `apps/seer/src/`.
- The file `apps/seer/src/adapters/google-chat.ts` (which contained the custom payload parser) has been deleted.
- Google Chat payload parsing is now handled entirely by `@chat-adapter/gchat` (SDK adapter).

### 2. Legacy custom Google Chat ingress code is removed or retired — PASS

- `apps/seer/src/adapters/google-chat.ts` — **deleted** (previously contained custom event parsing and routing).
- `handler.ts` delegates directly to `bot.webhooks.gchat(request)` — the SDK handles the entire request lifecycle.
- `bot.ts` uses `new Chat({ adapters: { gchat: createGoogleChatAdapter() } })` for all Google Chat ingress.
- Event handlers (`bot.onNewMention`, `bot.onSubscribedMessage`) receive SDK-normalised `Thread` and `Message` objects.

### 3. Obsolete custom chat-ingress locking is removed — PASS

- `apps/seer/src/state.ts` — **deleted** (previously contained `acquireThreadLock()` and a `Map`-based per-thread locking mechanism).
- Grep for `lock|mutex|acquireLock|threadLock` across `apps/seer/src/` returns zero hits in production code (only a comment in `handler.ts` documenting that the SDK handles locking internally, and unrelated test comments about non-blocking behavior).
- Per-thread serialization is now provided by `@chat-adapter/state-memory` via `createMemoryState()`.

### 4. GitLab webhook and non-chat subsystems remain intact — PASS

- `apps/seer/src/adapters/webhook.ts` exists and is 155 lines of active code.
- `handler.ts` routes `POST /webhook/branch-update` to `handleBranchUpdateWebhook()` — unchanged.
- Webhook adapter supports GitHub, GitLab, and generic push events.
- Webhook tests in `apps/seer/src/adapters/webhook.test.ts` cover parsing and reindex signaling.

## Test Results

```
Tests:    114 passed, 0 failed
Suites:   28
Duration: ~19.5s
```

All 114 unit tests pass, including:
- Google Chat SDK webhook delegation tests
- Effect/Mastra chat bridge tests
- Platform-qualified identity tests
- Webhook adapter tests
- Reindex worker tests

## Architecture After Migration

```
POST /google-chat/webhook
  → handler.ts (route matching)
  → bot.webhooks.gchat(request) [SDK parses payload, dispatches events]
  → bot.onNewMention / bot.onSubscribedMessage [SDK event handlers]
  → handleIncomingMessage(thread, message) [bot.ts]
    → qualifyUserId("gchat", message.author.userId) [identity.ts]
    → generateReply({threadId, userId, text}) [chat.ts — Effect boundary]
    → thread.post(reply) [SDK sends response]
```

## Key Commits

- `7962f9a` — feat(repochat): migrate google chat ingress to vercel/chat SDK
- `2971e85` — refactor(seer): replace custom thread locking with sdk serialization and use identity helpers for user qualification
