# Verification: Wire repochat agent grounding to codemogger search and file verification

**Date:** 2026-03-25
**Status:** ✅ PASS

## Summary

The repochat agent has been correctly wired to use codemogger MCP for codebase discovery and a native `read_file` tool for exact source verification. All acceptance criteria are met.

## Acceptance Criteria Verification

### ✅ Repochat can use codemogger search when answering codebase questions

- `apps/repochat/src/mcp.ts` exports `createCodemoggerClient()` which builds an MCP client from the shared `codemogger` server registration (`packages/mastra/src/mcp/codemogger.ts`).
- The codemogger registration launches `npx -y codemogger mcp` as a stdio MCP server with optional `CODEMOGGER_DB_PATH` env var.
- `apps/repochat/src/runtime.ts` loads codemogger MCP tools via `loadMCPTools("Codemogger", createCodemoggerClient)` in the Effect Layer.
- Loaded tools are merged into the agent's tool map and passed to `makeRepochatAgent(allTools)`.
- The system prompt in `agent.ts` explicitly instructs the agent: "Use codemogger search to discover relevant files and code when answering codebase questions."

### ✅ Repochat can read exact source files to verify retrieved context

- `apps/repochat/src/tools/read-file.ts` implements a native `read_file` tool with:
  - Path traversal security (scoped to `REPOCHAT_REPO_ROOT`)
  - File size cap (256 KB)
  - Line range selection (startLine/endLine)
  - Line-numbered output for easy reference
- The tool is always included in the agent's tool map (`runtime.ts` line 79: `read_file: readFileTool`).
- System prompt instructs: "After finding relevant results via codemogger, use the read_file tool to verify exact source code before quoting it."

### ✅ Grounded codebase answers flow through the normal chat path

- The `chat.ts` bridge passes messages through `agent.generate()` with memory options — the same path used for all chat. No separate retrieval path exists.
- Tools (codemogger + read_file) are bound to the agent at startup and invoked by the LLM during normal generation.
- The adapter layer (e.g., Google Chat webhook) calls `generateReply()` which uses the RepochatAgent Effect service — grounding is transparent to the caller.

### ✅ The implementation preserves the single-process repochat architecture

- `index.ts` starts a single HTTP server with `http.createServer`.
- The ManagedRuntime is created once and shared across all requests.
- MCP tools are loaded once at startup in the Effect Layer (lazy on first request).
- No separate retrieval service or process is introduced.

### ✅ Chat remains available regardless of indexing lifecycle activity

- The reindex worker runs as a background Effect fiber (`reindexWorkerLoop`), independent of the HTTP server.
- `createCodemoggerClient()` has no required env vars — it always returns a client. If codemogger MCP fails at tool-fetch time, the error is caught gracefully and the agent runs without codemogger tools.
- The `loadMCPTools` function in `runtime.ts` catches all errors and returns `null`, ensuring the agent is always created.
- The `read_file` native tool is always available regardless of MCP status.

## Test Results

### Unit Tests (repochat)
- **80/80 passed**, 0 failures
- Includes: `read-file.test.ts` (8 tests), `mcp.test.ts` (5 tests), `agent.test.ts` (3 tests), `chat.test.ts`, `memory.test.ts`, `state.test.ts`, `reindex-worker.test.ts`, `errors.test.ts`, `identity.test.ts`

### Integration Tests (repochat)
- **52/52 passed**, 0 failures
- Covers: Google Chat adapter, webhook adapter, runtime integration

### Mastra Package Tests
- **63/63 passed**, 0 failures
- Includes: `codemogger.test.ts` (6 tests), `registry.test.ts`, `glitchtip.test.ts`

### TypeScript Typecheck
- `tsc --noEmit` passed with no errors

## Key Files

| File | Role |
|------|------|
| `apps/repochat/src/agent.ts` | Agent factory with system prompt for grounding |
| `apps/repochat/src/tools/read-file.ts` | Native file-read tool for source verification |
| `apps/repochat/src/mcp.ts` | MCP client factories (codemogger + glitchtip) |
| `apps/repochat/src/runtime.ts` | Effect Layer wiring all tools into the agent |
| `apps/repochat/src/chat.ts` | Chat bridge (normal chat path) |
| `packages/mastra/src/mcp/codemogger.ts` | Codemogger MCP server registration |

## Architecture Note

The grounding flow is explicit: **codemogger search → read_file verification → grounded answer**. The system prompt guides the agent to follow this pattern without making it a rigid pipeline. The agent can still answer without codemogger if the MCP integration is unavailable, gracefully degrading to the read_file tool or conversational knowledge.
