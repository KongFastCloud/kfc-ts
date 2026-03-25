# Verification: Harden GlitchTip MCP Integration with Auth and Failure-Path Tests

**Date:** 2026-03-24
**Status:** PASS

## Summary

All acceptance criteria for the GlitchTip MCP auth and failure-path test hardening are met. A total of **44 tests** across 4 test files pass, covering MCP registration, env validation, auth failures, unreachable instances, malformed responses, read-only access, graceful degradation, and codebase-chat isolation.

## Test Results

### packages/mastra/src/mcp/glitchtip.test.ts — 18 tests ✅
- Server metadata (name = "glitchtip")
- Env var declarations: GLITCHTIP_TOKEN (required), GLITCHTIP_ORGANIZATION (required), GLITCHTIP_BASE_URL (optional)
- Prevents GLITCHTIP_SESSION_ID usage (security)
- Env validation: missing token, missing org, both missing, empty-string treated as missing
- Definition factory: stdio via `npx mcp-glitchtip`, env forwarding, default/custom base URL
- Read-only: description contains "read-only"
- Env contract: exactly 3 vars matching `.env.example`
- Security: does not forward unexpected env vars to subprocess

### packages/mastra/src/mcp/registry.test.ts — 9 tests ✅
- validateEnv: passes with required vars, passes when optional absent, throws MCPConfigError when missing, error includes server name and missing vars, empty string treated as missing
- buildMCPClient: creates MCPClient with resolved definitions, throws before construction on invalid env, forwards timeout, supports multiple registrations

### apps/seer/src/mcp.test.ts — 5 tests ✅
- Returns null when env vars are missing (graceful degradation)
- Returns MCPClient when env vars are present
- Returns null when only token is set (missing org)
- Returns null when only org is set (missing token)
- Returns null idempotently on repeated calls

### apps/seer/src/adapters/runtime.test.ts — 12 tests ✅
- **GlitchTip unavailable:** creates agent without tools; agent responds to normal questions
- **getTools() failure:** falls back on unreachable instance, invalid token (auth error), timeout; agent still generates replies after failure
- **Tools loaded successfully:** passes tools to agent; agent generates replies with tools available
- **Malformed responses:** handles null from getTools(); handles empty object from getTools()
- **Codebase-chat isolation:** chat flow identical whether GlitchTip absent or present; GlitchTip failure does not propagate to chat flow

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| MCP registration and env validation | ✅ | glitchtip.test.ts (18 tests), registry.test.ts (9 tests) |
| Invalid token, missing config, unreachable instance, malformed responses | ✅ | runtime.test.ts covers auth error, unreachable instance, timeout, null/empty responses; mcp.test.ts covers missing config permutations |
| Read-only access verified | ✅ | glitchtip.test.ts asserts description contains "read-only"; agent.ts system prompt constrains to read-only inspection |
| Normal codebase-chat works when GlitchTip unavailable | ✅ | runtime.test.ts "normal codebase-chat isolation" suite (2 tests); mcp.test.ts graceful null return |
| Env contract from .env.example covered | ✅ | glitchtip.test.ts asserts exactly 3 env vars matching documented contract; .env.example has GlitchTip section with GLITCHTIP_TOKEN, GLITCHTIP_ORGANIZATION, GLITCHTIP_BASE_URL |

## Architecture Notes

- **Mastra layer** (`packages/mastra/src/mcp/`): Reusable MCP registration infrastructure with GlitchTip-specific registration. Stateless, testable with injected env records.
- **Seer layer** (`apps/seer/src/`): App-specific `createGlitchTipClient()` wraps `buildMCPClient` with graceful degradation. Effect Layer in `runtime.ts` handles tool loading failures non-fatally.
- **No new product behavior** added — this slice is purely verification and hardening.
