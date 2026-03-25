# Verification Report: Actionable Startup Failure for Missing Google Chat Auth

**Date:** 2026-03-25
**Status:** PASS

## Summary

The implementation correctly adds actionable startup validation for missing Google Chat auth in seer. All acceptance criteria are met.

## What Was Verified

### 1. Unit Tests (PASS)
- Ran `config.test.ts`: 5/5 tests pass
  - Throws `ConfigurationError` when neither env var is set
  - Passes when `GOOGLE_CHAT_CREDENTIALS` is set
  - Passes when `GOOGLE_CHAT_USE_ADC=true` (case-insensitive)
  - Throws when `GOOGLE_CHAT_USE_ADC` is set but not "true"
- Ran `errors.test.ts`: 4/4 tests pass (including `ConfigurationError`)

### 2. Startup Behavior (PASS)
- Ran `node --experimental-strip-types src/bot.ts` without auth env vars
- Process exits with code 1 and a clear `ConfigurationError` message
- Error message includes:
  - Plain-language description: "Google Chat authentication is not configured."
  - Option A: Service account credentials with example JSON shape
  - Option B: ADC with `gcloud auth application-default login` command
  - Reference to README.md and .env.example for details

### 3. Code Quality (PASS)
- `validateGoogleChatAuth()` in `config.ts` performs env var validation
- Called at module scope in `bot.ts` (line 40) BEFORE adapter construction
- `ConfigurationError` is a dedicated error class in `errors.ts` with clear `name` property
- Adapter construction is wrapped in try-catch to also handle malformed credentials
- Implementation stays within startup clarity scope; no redesign of chat integration

### 4. Documentation Alignment (PASS)
- `.env.example` documents both `GOOGLE_CHAT_CREDENTIALS` and `GOOGLE_CHAT_USE_ADC`
- Error message references match the documented auth paths
- README.md documents Google Chat auth in both Environment section and dedicated setup section

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Starting seer without required Google Chat auth fails clearly and actionably | PASS |
| Startup failure identifies missing auth as an app-level configuration problem | PASS |
| Implementation stays within startup clarity/validation scope | PASS |
| Startup messaging aligns with documented auth paths | PASS |

## Files Reviewed

- `apps/seer/src/config.ts` — `validateGoogleChatAuth()` function
- `apps/seer/src/errors.ts` — `ConfigurationError` class
- `apps/seer/src/bot.ts` — Validation call and adapter try-catch
- `apps/seer/src/config.test.ts` — Unit tests for validation
- `apps/seer/.env.example` — Auth env var documentation
