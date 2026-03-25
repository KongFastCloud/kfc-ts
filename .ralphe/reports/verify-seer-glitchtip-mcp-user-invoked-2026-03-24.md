# Verification: Enable user-invoked GlitchTip issue and event inspection in seer

**Date:** 2026-03-24
**Status:** PASS

## Summary

The GlitchTip MCP integration in seer is correctly implemented. All acceptance criteria are met, all tests pass, and the architecture follows the design requirements.

## Acceptance Criteria Verification

### 1. Seer can use GlitchTip MCP tools during an explicit user request — PASS

- `apps/seer/src/runtime.ts` builds the agent with GlitchTip MCP tools when env vars are configured
- `apps/seer/src/mcp.ts` provides `createGlitchTipClient()` that uses the reusable `buildMCPClient([glitchtip])` from `@workspace/mastra/mcp`
- Tools are fetched via `client.getTools()` and bound to the agent at startup
- The agent system prompt explicitly instructs use of GlitchTip tools only on explicit user request

### 2. The bot can inspect issue lists and recent event details through chat — PASS

- GlitchTip MCP tools are provided by the `mcp-glitchtip` stdio subprocess (spawned via `npx -y mcp-glitchtip`)
- System prompt guides: "listing issues, viewing event details, and summarizing error context"
- Tools are bound to the Mastra Agent which can invoke them during generation

### 3. GlitchTip usage remains read-only — PASS

- Registration description: "Read-only access to GlitchTip issues and events via mcp-glitchtip"
- System prompt: "stick to read-only inspection — listing issues, viewing event details, and summarizing error context"
- `mcp-glitchtip` server itself provides only read operations
- No mutation tools are exposed or configured

### 4. Unrelated codebase-chat turns do not require GlitchTip — PASS

- System prompt: "Use GlitchTip tools ONLY when the user explicitly asks about production errors, exceptions, crashes, or GlitchTip issues. Do not call GlitchTip tools for general codebase questions, architecture discussions, or unrelated conversations."
- Graceful degradation: when GlitchTip env vars are missing, agent operates in codebase-only mode (returns `null` from `createGlitchTipClient()`)
- Tools are optional — the `makeSeerAgent(tools?)` factory accepts optional tools

### 5. Single-repo GlitchTip setup without multi-project routing — PASS

- Single `GLITCHTIP_ORGANIZATION` env var scopes to one organization
- No multi-project routing logic exists
- Registration is a flat single-server configuration

## Architecture Review

### Reusable MCP Foundation (`packages/mastra/src/mcp/`)

| File | Purpose |
|------|---------|
| `types.ts` | Generic `MCPServerRegistration` and `EnvRequirement` interfaces |
| `registry.ts` | `buildMCPClient()` factory with env validation and `MCPConfigError` |
| `glitchtip.ts` | GlitchTip-specific registration (env vars, stdio command) |
| `index.ts` | Public exports via `@workspace/mastra/mcp` |

### Seer Integration (`apps/seer/src/`)

| File | Purpose |
|------|---------|
| `mcp.ts` | `createGlitchTipClient()` with graceful degradation |
| `agent.ts` | `makeSeerAgent(tools?)` with GlitchTip system prompt |
| `runtime.ts` | Effect Layer wiring MCP tools to agent at startup |
| `.env.example` | Documents GlitchTip env vars |

### Agent Factory (`packages/mastra/src/agent-factory.ts`)

- `AgentOptions` interface includes `tools?: ToolsInput`
- `createAgent()` passes tools to Mastra `Agent` constructor

## Test Results

### `packages/mastra/src/mcp/` — 21 tests PASS
- `glitchtip.test.ts`: 12 tests (metadata, env validation, definition factory)
- `registry.test.ts`: 9 tests (validateEnv, buildMCPClient, MCPConfigError)

### `apps/seer/src/mcp.test.ts` — 2 tests PASS
- Returns null when env vars missing (graceful degradation)
- Returns MCPClient with getTools() when env vars present

### `apps/seer/src/agent.test.ts` — 5 tests PASS
- Agent creation with and without tools
- SeerAgent Effect service tag

### TypeScript
- `packages/mastra` typechecks cleanly (`tsc --noEmit` passes)

## Non-goals Confirmed Not Implemented

- No background polling
- No alert ingestion
- No cross-repo routing
- No mutation of GlitchTip state
