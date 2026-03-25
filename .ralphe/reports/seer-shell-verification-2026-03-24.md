# Verification Report: Seer Shell with Direct Google Chat Ingress

**Date:** 2026-03-24
**Status:** PASS

## Summary

The seer app/service has been correctly implemented as a new service shell at `apps/seer/` with a direct Google Chat webhook ingress path routed through the Vercel AI Gateway. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. A new seer app/service exists and can run in the same Coder instance as the repo
**PASS** — The app lives at `apps/seer/` in the monorepo, uses `pnpm` workspace references (`@workspace/mastra`), and runs via `node --experimental-strip-types src/index.ts` on port 4320 (configurable via `PORT` env var). No external infrastructure required beyond the AI Gateway API key.

### 2. Google Chat webhook requests are accepted by a direct vercel/chat endpoint
**PASS** — `POST /google-chat/webhook` accepts Google Chat webhook payloads. The handler in `src/adapters/google-chat.ts` supports MESSAGE, ADDED_TO_SPACE, and REMOVED_FROM_SPACE event types. The chat bridge in `src/chat.ts` calls the Vercel AI SDK's `streamText()` via `@workspace/mastra/chat`, collecting the stream into a synchronous reply. No intermediate normalization layer exists — the webhook routes directly through to the AI gateway.

### 3. Incoming requests are mapped to stable platform-qualified thread and user IDs
**PASS** — `src/identity.ts` provides `qualifyThreadId` and `qualifyUserId` functions that produce `QualifiedId` objects with format `gchat:<raw-id>`. For example:
- Thread: `gchat:spaces/SPACE1/threads/THREAD1`
- User: `gchat:users/112233`

The identity module supports multiple platforms (`"gchat" | "discord"`) for future extensibility.

### 4. The request path is verifiable end-to-end with at least a minimal response
**PASS** — 20 tests (7 unit + 13 integration) all pass:
- Unit tests cover identity qualification and thread locking
- Integration tests mock the chat bridge and verify the full handler chain: routing, event parsing, identity mapping, error handling, thread name echoing, and argumentText extraction

### 5. No blueprints dependency exists in the main request path
**PASS** — Grep for "blueprint" (case-insensitive) in `apps/seer/` returns zero results. The dependency chain is: handler.ts -> google-chat.ts -> chat.ts -> @workspace/mastra/chat -> Vercel AI SDK. No blueprints involvement.

## Test Results

### Unit Tests (identity + state): 7/7 pass
```
✔ qualifies a gchat thread id
✔ qualifies a gchat user id
✔ qualifies a discord id
✔ different platforms produce different qualified ids for the same raw id
✔ acquires and releases a lock
✔ serialises concurrent acquires on the same thread
✔ allows concurrent acquires on different threads
```

### Integration Tests (Google Chat adapter): 13/13 pass
```
✔ GET /health returns ok
✔ unknown route returns 404
✔ POST /google-chat/webhook with invalid JSON returns 400
✔ POST /google-chat/webhook ADDED_TO_SPACE returns greeting
✔ POST /google-chat/webhook REMOVED_FROM_SPACE returns empty 200
✔ routes a MESSAGE event through the chat bridge and returns the reply
✔ passes platform-qualified threadId and userId to the chat bridge
✔ uses argumentText (stripped @mention) as the message text
✔ falls back to text when argumentText is absent
✔ echoes the thread name in the response for threading
✔ returns a friendly error when the chat bridge fails
✔ returns a fallback when message text is empty
✔ handles MESSAGE event missing the message field
```

### TypeScript: compiles cleanly (tsc --noEmit passes with no errors)

## Architecture

```
HTTP Server (index.ts, port 4320)
├── GET  /health              → { ok: true, service: "seer" }
└── POST /google-chat/webhook → Google Chat adapter
    ├── Event parsing & validation
    ├── Platform-qualified ID generation (identity.ts)
    ├── Per-thread locking (state.ts)
    └── Chat bridge (chat.ts) → @workspace/mastra → Vercel AI Gateway
```

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 61 | HTTP server entry point |
| `src/handler.ts` | 45 | Request router |
| `src/adapters/google-chat.ts` | 184 | Google Chat webhook handler |
| `src/chat.ts` | 45 | Chat bridge (Vercel AI Gateway) |
| `src/identity.ts` | 37 | Platform-qualified ID helpers |
| `src/state.ts` | 48 | In-memory thread locking |
| `src/log.ts` | 17 | Structured logging |
| `src/identity.test.ts` | 35 | Identity unit tests |
| `src/state.test.ts` | 49 | State unit tests |
| `src/adapters/google-chat.test.ts` | 197 | Integration tests |
