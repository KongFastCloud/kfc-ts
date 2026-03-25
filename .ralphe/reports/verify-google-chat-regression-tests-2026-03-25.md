# Verification Report: Google Chat Migration Regression Tests

**Date:** 2026-03-25
**Task:** Harden the vercel/chat migration with realistic Google Chat regression tests
**Status:** ✅ PASS

## Summary

All acceptance criteria are met. The regression test suite comprehensively covers the SDK-backed Google Chat ingress path with realistic event payloads, identity mapping, lifecycle events, and GitLab webhook isolation.

## Test Execution Results

- **Unit tests:** 114 tests, 114 pass, 0 fail
- **Integration tests:** 71 tests, 71 pass, 0 fail

## Acceptance Criteria Verification

### ✅ Tests cover realistic Google Chat event payloads that the SDK-backed ingress accepts

**File:** `apps/seer/src/adapters/google-chat-regression.test.ts`

8 realistic fixtures are defined:
- `MESSAGE_ROOM_PAYLOAD` — Room @-mention with annotations, sender, thread, space
- `MESSAGE_DM_PAYLOAD` — Direct message with singleUserBotDm flag
- `MESSAGE_CODE_BLOCK_PAYLOAD` — Multi-line code block content
- `ADDED_TO_SPACE_PAYLOAD` — Bot added to a room
- `ADDED_TO_DM_PAYLOAD` — Bot added to a DM
- `REMOVED_FROM_SPACE_PAYLOAD` — Bot removed from a space
- `MESSAGE_EMPTY_TEXT_PAYLOAD` — Edge case: whitespace-only text
- `CARD_CLICKED_PAYLOAD` — Unsupported event type

All payloads include realistic Google Chat API fields (eventTime, token, sender with avatarUrl/email/domainId, space with displayName/singleUserBotDm, annotations array, etc.).

### ✅ Tests verify message handling still reaches the existing reply path and returns a final text response

- "room @-mention message is delegated to SDK with full payload intact" — verifies the SDK webhook handler is called exactly once and the response body contains `{ text: "SDK handled" }`
- "SDK response body is returned directly to the caller" — explicitly asserts the response text
- "event type field is preserved in payload (guards against type=undefined regression)" — directly guards against the specific regression that motivated this task

### ✅ Tests verify ADDED_TO_SPACE and REMOVED_FROM_SPACE behavior remains sensible after migration

- 3 ADDED_TO_SPACE tests: room addition, DM addition, displayName preservation
- 2 REMOVED_FROM_SPACE tests: delegation to SDK, no-crash guarantee
- Tests verify type field, space.name, space.type, user.name, and singleUserBotDm fields are all preserved

### ✅ Tests verify stable thread and user identity mapping into Mastra memory

**8 identity mapping tests in the regression file:**
- `qualifyUserId` produces stable gchat-prefixed IDs (deterministic)
- `qualifyThreadId` produces stable gchat-prefixed thread IDs
- Different users → different qualified IDs
- Different threads → different qualified IDs
- Same user on different platforms → isolated IDs (prevents memory leakage)
- `qualifyId` is deterministic across 10 invocations (no randomness)
- Thread IDs from realistic payloads match expected qualification format
- User IDs from realistic payloads match expected qualification format

**Additional identity tests in `identity.test.ts`** (8 more tests covering cross-platform isolation).

### ✅ Tests confirm the GitLab webhook path remains unaffected by the migration

**4 tests in the regression file:**
- POST `/webhook/branch-update` with GitLab header does not trigger Google Chat SDK
- POST `/webhook/branch-update` with GitHub header does not trigger Google Chat SDK
- GET `/health` does not trigger Google Chat SDK
- Unknown routes return 404 and do not trigger Google Chat SDK

**1 additional test in `google-chat.test.ts`:**
- POST `/webhook/branch-update` is still routed (not 404)

## Test Architecture

- Tests use Node.js native test runner with `--experimental-test-module-mocks`
- Bot module is mocked to capture the Request objects passed to `bot.webhooks.gchat`
- Handler is imported after mocks are registered (correct mock isolation)
- Identity helpers are tested directly since they're pure functions
- Each describe block resets mocks in beforeEach for test isolation

## Key Regression Guards

1. **type=undefined regression:** Explicit test that the `type` field is preserved in payloads passed to the SDK
2. **Payload shape fidelity:** Tests assert on specific nested fields (sender.name, thread.name, space.type, annotations)
3. **Request integrity:** Tests verify the original Request object (not a re-serialized copy) is passed to the SDK
4. **Route stability:** Tests confirm the webhook route path `/google-chat/webhook` has not been renamed
