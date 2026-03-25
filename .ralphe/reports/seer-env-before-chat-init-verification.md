# Verification Report: Seer Startup Env Loading Before Chat SDK Construction

**Date:** 2026-03-25
**Status:** PASS

## Summary

The refactoring correctly ensures that `.env.local` and `.env` files are loaded via `dotenv.config()` before any module that constructs the Google Chat adapter is imported.

## Acceptance Criteria Verification

### 1. .env.local/.env values are loaded before the Google Chat adapter is constructed — PASS

In `src/index.ts`, the startup order is:

1. **Lines 32-33**: `dotenv.config()` runs for `.env.local` and `.env`
2. **Line 36**: `await import("./handler.ts")` — dynamic import AFTER env loading
3. `handler.ts` statically imports `bot.ts`
4. `bot.ts` calls `createGoogleChatAdapter()` at module level

Because `handler.ts` is dynamically imported (not statically), its entire import subtree (including `bot.ts`) only evaluates after `dotenv.config()` has populated `process.env`. This is the core fix — previously, static imports caused `bot.ts` to execute before `dotenv.config()`.

### 2. Env-driven auth settings such as GOOGLE_CHAT_USE_ADC can affect adapter initialization — PASS

- `bot.ts` line 40 calls `validateGoogleChatAuth()` before constructing the adapter
- `config.ts` `validateGoogleChatAuth()` reads `process.env.GOOGLE_CHAT_CREDENTIALS` and `process.env.GOOGLE_CHAT_USE_ADC` at call time
- Since the module only loads after dotenv, these values are guaranteed to be available
- Config test (`config.test.ts`) validates that `GOOGLE_CHAT_USE_ADC=true` (case-insensitive) passes validation

### 3. Same routes and overall startup behavior — PASS

Routes remain unchanged:
- `GET /health` — health check
- `POST /google-chat/webhook` — Google Chat ingress via `bot.webhooks.gchat`
- `POST /webhook/branch-update` — Git provider branch-update webhook

The server startup sequence (startup tasks → background worker → listen) is preserved.

### 4. Fix stays within startup-order and env-visibility scope — PASS

The change is minimal and surgical:
- `index.ts`: Replaced static imports of app modules with dynamic `await import()` calls after `dotenv.config()`
- `bot.ts`: Added `validateGoogleChatAuth()` call and error wrapping for the adapter constructor
- `config.ts`: Added `validateGoogleChatAuth()` function
- No changes to routes, process model, or Chat SDK usage patterns

## Test Results

All 120 tests pass, including:
- `validateGoogleChatAuth` — 5 tests covering credentials, ADC (case-insensitive), and missing config
- Google Chat adapter regression tests
- Startup task tests
- All other existing tests

## Key Design Decision

Using dynamic `await import()` instead of static `import` at the top of `index.ts` is the correct approach. JavaScript static imports are hoisted and evaluated before any module-level code runs, which means `dotenv.config()` would always run after static imports. Dynamic imports execute at the point they appear in the code flow, ensuring env vars are available.
