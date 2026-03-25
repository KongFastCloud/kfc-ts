# repochat

Chat-first codebase exploration service that runs in the same Coder instance as the repository.

`repochat` currently exposes a Google Chat webhook, routes incoming messages through an Effect-based boundary, and answers with a Mastra-backed agent using Vercel AI Gateway. GlitchTip MCP tools are loaded at startup when the required environment variables are present.

## What It Does

- Accepts Google Chat webhook events
- Normalizes platform-qualified thread and user ids
- Uses Mastra memory for:
  - thread-local message history
  - resource-scoped working memory
- Uses `@workspace/mastra` for shared agent and MCP primitives
- Returns a final text answer back to Google Chat
- Gracefully degrades when GlitchTip MCP is not configured

## Routes

- `GET /health`
- `POST /google-chat/webhook`

## Architecture

- `src/index.ts`
  - boots the HTTP server and loads env from `.env.local` or `.env`
- `src/handler.ts`
  - routes HTTP requests to health or adapter handlers
- `src/adapters/google-chat.ts`
  - parses Google Chat events and turns them into chat requests
- `src/chat.ts`
  - Effect boundary around the Mastra agent call
- `src/agent.ts`
  - repochat-specific Mastra agent composition and prompt
- `src/memory.ts`
  - Mastra memory configuration
- `src/mcp.ts`
  - optional GlitchTip MCP client creation
- `src/runtime.ts`
  - shared Effect runtime and startup-time tool binding
- `src/state.ts`
  - in-memory per-thread lock for local single-instance use

## Identity Model

Repochat qualifies ids by platform before passing them into memory:

- thread id: `gchat:<raw-thread-id>`
- user id: `gchat:<raw-user-id>`

This gives:

- thread-local history inside one conversation
- resource-scoped working memory across threads for the same user
- no accidental cross-platform leakage if Discord or other adapters are added later

## Environment

Copy the example file and fill in values:

```bash
cd apps/repochat
cp .env.example .env.local
```

Required for basic chat:

- `AI_GATEWAY_API_KEY`

Optional with defaults:

- `PORT`
- `AI_GATEWAY_BASE_URL`

Required for GlitchTip MCP:

- `GLITCHTIP_TOKEN`
- `GLITCHTIP_ORGANIZATION`

Optional for GlitchTip MCP:

- `GLITCHTIP_BASE_URL`

If the GlitchTip vars are missing, repochat still starts and serves normal codebase chat without error-inspection tools.

## Run

```bash
pnpm --filter repochat dev
```

Production-style start:

```bash
pnpm --filter repochat start
```

Default local URL:

```text
http://localhost:4320
```

## Tests

Run the package tests:

```bash
pnpm --filter repochat test
pnpm --filter repochat test:integration
pnpm --filter repochat typecheck
```

## Current Behavior

- Google Chat is the only adapter currently wired
- Replies are final-answer only
- Card-based Google Chat responses are not implemented
- Thread locking is in-memory and single-process
- GlitchTip is read-only and user-invoked through the agent prompt/tools

## Notes

- Repo facts should come from codebase access and tools, not working memory
- Working memory is reserved for user context and conversational continuity
- The current state layer is suitable for one local process; replace it before multi-instance deployment
