# Verification: Harden seer Google Chat auth setup with startup and docs regression tests

**Date:** 2026-03-25
**Status:** PASS

## Summary

All acceptance criteria are met. The implementation provides comprehensive regression coverage for the Google Chat auth setup contract, startup failure behavior, and success-path validation.

## Test Results

- **Unit tests:** 156 passed, 0 failed
- **Integration tests:** 71 passed, 0 failed

## Acceptance Criteria Verification

### 1. Regression coverage verifies the Google Chat auth env contract is represented in setup surfaces ✅

File: `apps/seer/src/startup/auth-contract-regression.test.ts` (Section 1: "setup surfaces document the auth contract")

- Verifies `.env.example` mentions both `GOOGLE_CHAT_CREDENTIALS` and `GOOGLE_CHAT_USE_ADC`
- Verifies `README.md` mentions both auth env vars
- Verifies `.env.example` documents both auth options (A: service account, B: ADC)
- Verifies `README.md` has an Authentication section and documents both options
- Verifies both docs warn about startup failure when auth is missing
- Verifies `README.md` references `.env.example` for setup

### 2. Regression coverage verifies missing-auth startup failure is clear and actionable ✅

File: `apps/seer/src/startup/auth-contract-regression.test.ts` (Section 2: "missing-auth startup failure is clear and actionable")

- Confirms `validateGoogleChatAuth()` throws `ConfigurationError` (not raw SDK error) when auth is missing
- Error message names both auth options so operators know what to set
- Error message includes setup guidance referencing `README.md` and `.env.example`
- Error message describes Option A (service account credentials) and Option B (ADC)

Additionally, Section 5 ("validation error references match actual setup file locations") verifies that the README.md and .env.example files referenced in error messages actually exist on disk.

### 3. Startup success-path coverage is added where feasible ✅

File: `apps/seer/src/startup/auth-contract-regression.test.ts` (Section 3: "startup success path with valid auth config")

- Passes with `GOOGLE_CHAT_CREDENTIALS` alone
- Passes with `GOOGLE_CHAT_USE_ADC=true` alone
- Passes when both auth options are set
- Rejects `GOOGLE_CHAT_USE_ADC` set to non-true values (e.g., "yes")
- Rejects empty `GOOGLE_CHAT_CREDENTIALS`

Additional unit tests in `apps/seer/src/config.test.ts`:
- Passes with `GOOGLE_CHAT_USE_ADC=TRUE` (case-insensitive)
- Rejects `GOOGLE_CHAT_USE_ADC=false`

### 4. Tests stay focused on setup and startup-validation behavior ✅

- `auth-contract-regression.test.ts` is 402 lines focused entirely on setup surfaces (docs, env examples) and startup validation logic
- Structural tests (Section 4) verify `bot.ts` calls `validateGoogleChatAuth()` before `createGoogleChatAdapter()` without testing actual adapter functionality
- `env-loading.test.ts` covers the startup ordering contract (dotenv before adapter init)
- No tests re-test the Google Chat SDK integration (that's covered separately in `adapters/google-chat-regression.test.ts`)

## Key Files

| File | Purpose |
|------|---------|
| `src/startup/auth-contract-regression.test.ts` | Main regression test suite (402 lines) |
| `src/startup/env-loading.test.ts` | Env loading order regression tests (184 lines) |
| `src/config.test.ts` | Unit tests for validateGoogleChatAuth (63 lines) |
| `src/config.ts` | Auth validation function |
| `src/errors.ts` | ConfigurationError class |
| `src/bot.ts` | Startup orchestration (validate → adapter) |
| `.env.example` | Auth env documentation |
| `README.md` | Auth setup documentation |
