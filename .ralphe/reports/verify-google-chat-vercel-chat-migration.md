# Verification Report: Google Chat Ingress Migration to vercel/chat

**Date:** 2026-03-25
**Task:** Cut over Google Chat ingress to vercel/chat on /google-chat/webhook
**Result:** PASS

---

## Acceptance Criteria Verification

### 1. POST /google-chat/webhook handled through vercel/chat — PASS

`handler.ts` line 37 delegates directly to the Chat SDK:
```typescript
return bot.webhooks.gchat(request)
```

The `bot` instance (in `bot.ts`) is created with:
- `Chat` from the `chat` package (vercel/chat SDK v4.22.0)
- `createGoogleChatAdapter()` from `@chat-adapter/gchat` v4.22.0
- `createMemoryState()` from `@chat-adapter/state-memory` v4.22.0

No custom Google Chat payload parsing is in the request path.

### 2. Public route remains /google-chat/webhook — PASS

`handler.ts` routes `POST /google-chat/webhook` unchanged. Integration test `"the webhook route path is /google-chat/webhook (unchanged)"` explicitly verifies this.

### 3. App remains a single-process workspace service — PASS

`index.ts` starts a single Node.js HTTP server on port 4320. No additional processes or workers are spawned. The in-memory state adapter (`@chat-adapter/state-memory`) is appropriate for single-process deployment.

### 4. GitLab webhook route /webhook/branch-update unaffected — PASS

`handler.ts` lines 41-49 still route `POST /webhook/branch-update` to `handleBranchUpdateWebhook`. Integration test `"POST /webhook/branch-update is still routed (not 404)"` verifies this. The webhook handler and its tests are unchanged.

### 5. No new custom Google Chat payload schema introduced — PASS

The deprecated `adapters/google-chat.ts` still exists but is not imported or used by `handler.ts` or `bot.ts`. The Chat SDK handles all payload parsing internally. `bot.ts` only works with SDK-normalized `Thread` and `Message` types.

---

## Guardrail Check

The task explicitly prohibits satisfying the issue by patching `adapters/google-chat.ts` to parse more payload variants. Verified: `adapters/google-chat.ts` is not imported in the active request path. The ingress is fully SDK-backed.

---

## Test Results

### Unit Tests (`pnpm test`) — 22/22 passed
- Bot message handler: 8 tests (threadId/userId qualification, reply posting, error handling, subscription)
- Agent/runtime: 14 tests

### Integration Tests (`pnpm test:integration`) — 40/40 passed
- Handler routing: 2 tests (health check, 404)
- Google Chat SDK delegation: 6 tests (delegation, passthrough, error propagation, route matching)
- GitLab webhook: 1 test (route preserved)
- Branch-update webhook: 8 tests
- Runtime/tool composition: 23 tests

---

## Key Implementation Files

| File | Role |
|------|------|
| `src/bot.ts` | NEW — Chat SDK instance, event handlers (`onNewMention`, `onSubscribedMessage`) |
| `src/bot.test.ts` | NEW — Unit tests for bot event handler logic |
| `src/handler.ts` | MODIFIED — Routes `/google-chat/webhook` to `bot.webhooks.gchat(request)` |
| `src/adapters/google-chat.test.ts` | MODIFIED — Refactored to test SDK delegation |
| `package.json` | MODIFIED — Added `chat`, `@chat-adapter/gchat`, `@chat-adapter/state-memory` dependencies |
| `src/adapters/google-chat.ts` | DEPRECATED — Still present but not imported in active path |

---

## Dependencies Added

- `chat` v4.22.0 — Vercel Chat SDK core
- `@chat-adapter/gchat` v4.22.0 — Google Chat adapter
- `@chat-adapter/state-memory` v4.22.0 — In-memory state adapter
