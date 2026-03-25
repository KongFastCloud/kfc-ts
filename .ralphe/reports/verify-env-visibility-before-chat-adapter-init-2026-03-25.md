# Verification: Startup Regression Coverage for Env Visibility Before Google Chat Adapter Init

**Date:** 2026-03-25
**Status:** ✅ PASS

## Summary

Verified that regression coverage for the startup-order bug (env-driven auth config must be visible before Google Chat adapter initialization) is correctly implemented and all tests pass.

## What Was Verified

### 1. Regression Test File: `apps/seer/src/startup/env-loading.test.ts`

Contains 6 focused regression tests:

| # | Test | Purpose |
|---|------|---------|
| 1 | dotenv populates GOOGLE_CHAT_USE_ADC before validateGoogleChatAuth runs | Simulates correct startup sequence |
| 2 | mirrors the startup sequence: dotenv then validation (ADC path) | Creates temp `.env.local` file, loads via dotenv, validates env is populated |
| 3 | fails fast when GOOGLE_CHAT_USE_ADC is absent (the previously broken case) | Proves validation rejects when env var is missing |
| 4 | index.ts uses dynamic imports for app modules (structural guard) | Reads `index.ts` source and asserts `dotenv.config()` appears before `await import("./handler.ts")` |
| 5 | GOOGLE_CHAT_USE_ADC=true set before validation mirrors the fixed startup | End-to-end env visibility check |
| 6 | GOOGLE_CHAT_USE_ADC set after validation would fail (proves ordering matters) | Proves the test suite would catch a regression |

### 2. Config Validation Tests: `apps/seer/src/config.test.ts`

5 tests for `validateGoogleChatAuth()` covering all auth permutations.

### 3. Production Code: `apps/seer/src/index.ts`

The fix is in place: `dotenv.config()` (lines 32-33) runs before dynamic `await import()` of app modules (lines 36-39). Static imports of `dotenv`, `http`, `path`, and `url` are hoisted safely since they don't read env vars.

## Test Results

```
env-loading.test.ts: 6/6 pass, 0 fail
config.test.ts:      5/5 pass, 0 fail
Total:              11/11 pass
```

## Acceptance Criteria Assessment

- ✅ **Regression coverage proves env values are visible before Google Chat adapter initialization** — Tests 1, 2, and 5 explicitly verify env vars are readable before validation runs.
- ✅ **The previously broken GOOGLE_CHAT_USE_ADC startup case is covered** — Test 3 covers the absent-env case; Tests 1/2/5 cover the fixed case.
- ✅ **Tests stay focused on startup ordering and env visibility** — All 6 tests in env-loading.test.ts focus exclusively on startup order and env visibility, not broad Google Chat behavior.
- ✅ **The regression coverage would fail if env loading regressed** — Test 4 (structural guard) checks index.ts source for dynamic imports after dotenv; Test 6 explicitly proves that late env setting causes validation failure.
