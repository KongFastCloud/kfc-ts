# Verification: Google Chat Adapter Auth Documentation

**Date:** 2026-03-25
**Status:** PASS

## What Was Verified

Checked that the seer README and .env.example correctly document the Google Chat adapter auth requirements, aligning setup docs with the runtime implementation in `bot.ts`.

## Acceptance Criteria Results

| Criterion | Status | Evidence |
|-----------|--------|----------|
| README explicitly documents Google Chat adapter auth requirement | PASS | README lines 127-131 (Environment section) and lines 279-319 (dedicated Authentication subsection under Google Chat Setup) |
| .env.example includes relevant Google Chat auth env variables | PASS | .env.example lines 23-38 document both `GOOGLE_CHAT_CREDENTIALS` and `GOOGLE_CHAT_USE_ADC` with clear comments |
| Docs explain GOOGLE_CHAT_CREDENTIALS and GOOGLE_CHAT_USE_ADC clearly for local/workspace setup | PASS | README provides Option A (service account) vs Option B (ADC) with usage examples, a recommendation table by environment, and links to official Google references |
| Setup docs no longer imply AI_GATEWAY_API_KEY alone is sufficient | PASS | README line 131 explicitly states: "AI_GATEWAY_API_KEY alone is not sufficient — the Google Chat adapter requires its own authentication" |

## Implementation Details

- `bot.ts` calls `createGoogleChatAdapter()` at line 39 with no arguments — auth is resolved from environment variables by the adapter
- README documents the auth requirement in two places: the Environment section (quick reference) and a dedicated Authentication subsection (detailed guidance with examples)
- .env.example groups auth vars under a clear `── Google Chat Adapter Auth ──` header with inline documentation for both options
- The recommendation table covers local dev, workspace/Coder, and GCE/Cloud Run scenarios

## Files Reviewed

- `apps/seer/README.md` — fully documents auth paths, failure behavior, and environment recommendations
- `apps/seer/.env.example` — includes both auth env vars with explanatory comments
- `apps/seer/src/bot.ts` — confirms `createGoogleChatAdapter()` is the runtime entry point requiring auth
