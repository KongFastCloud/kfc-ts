# Verification: Codemogger Integration & Repo File-Read Primitives for Repochat

**Date:** 2026-03-25
**Status:** ✅ PASS

## Summary

The codemogger integration and repo file-read primitives for repochat have been correctly implemented. All acceptance criteria are met, all tests pass, and the design follows the single-process repochat runtime model without introducing a separate indexing service.

## Acceptance Criteria Verification

### ✅ Codemogger-backed search is available to repochat as a grounding primitive
- **File:** `packages/mastra/src/mcp/codemogger.ts` — defines a reusable `MCPServerRegistration` for codemogger
- **File:** `apps/repochat/src/mcp.ts` — `createCodemoggerClient()` factory builds an MCP client from the registration
- **File:** `apps/repochat/src/runtime.ts` — codemogger tools loaded at startup via `loadMCPTools("Codemogger", createCodemoggerClient)` and merged into the agent's tool set
- Transport: `npx -y codemogger mcp` (stdio), with optional `--db` flag via `CODEMOGGER_DB_PATH`

### ✅ A direct file-read primitive exists for exact source verification
- **File:** `apps/repochat/src/tools/read-file.ts` — `readFileTool` created via `@mastra/core/tools`
- Tool ID: `read_file`
- Supports full file reads and line-range reads (`startLine`, `endLine`)
- Security: path traversal rejection, scoped to `REPOCHAT_REPO_ROOT`, 256 KB size cap, 500 line range cap
- Returns content with line numbers for agent-friendly formatting

### ✅ The grounding primitives fit inside the existing repochat runtime model
- Both tools are bound in `runtime.ts` within the `RepochatAgentLayer` Effect layer
- No separate service, worker, or process is introduced
- Codemogger runs via MCP stdio transport (child process, not a separate service)
- `read_file` is a native in-process tool (always available)
- Graceful degradation: if codemogger tools fail to load, the agent continues with `read_file` only

### ✅ Prompt-only codebase reasoning is no longer the only grounding mechanism
- Agent system prompt in `agent.ts` includes a "Codebase grounding" section:
  - "Use codemogger search to discover relevant files and code when answering codebase questions."
  - "After finding relevant results via codemogger, use the read_file tool to verify exact source code before quoting it."
- Two complementary mechanisms: codemogger (discovery) + read_file (verification)

### ✅ No separate indexing service is introduced
- Codemogger is accessed via MCP stdio transport (`npx codemogger mcp`)
- No daemon, worker, webhook handler, or external service
- No startup sync logic or orchestration

## Test Results

### Repochat (`pnpm --filter repochat test`)
- **76 tests, 0 failures**
- Includes dedicated `read_file tool` test suite (8 tests): full file reads, line ranges, clamping, path traversal rejection, missing files, empty files

### Mastra Package (`pnpm --filter @workspace/mastra test`)
- **63 tests, 0 failures** across 9 test files
- Includes `codemogger.test.ts` (6 tests): registration shape, no required env vars, optional `CODEMOGGER_DB_PATH`, definition factory produces correct `npx` command

## Architecture Overview

```
Agent Tool Set
├── codemogger (MCP stdio) — semantic/keyword code search
├── glitchtip (MCP stdio, optional) — production error inspection
└── read_file (native) — direct file-read for verification
```

Tool composition in `runtime.ts`:
```typescript
const allTools: ToolsInput = {
  ...(codemoggerTools ?? {}),
  ...(glitchtipTools ?? {}),
  read_file: readFileTool,  // Always available
}
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/mastra/src/mcp/codemogger.ts` | Codemogger MCP server registration |
| `packages/mastra/src/mcp/codemogger.test.ts` | Codemogger registration tests |
| `apps/repochat/src/tools/read-file.ts` | File-read grounding tool |
| `apps/repochat/src/tools/read-file.test.ts` | File-read tool tests |
| `apps/repochat/src/tools/index.ts` | Native tool exports |
| `apps/repochat/src/mcp.ts` | MCP client factories (codemogger + glitchtip) |
| `apps/repochat/src/runtime.ts` | Effect layer binding all tools to agent |
| `apps/repochat/src/agent.ts` | Agent with grounding instructions in system prompt |
