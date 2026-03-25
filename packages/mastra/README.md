# @workspace/mastra

Shared Mastra primitives for this monorepo.

This package is intentionally low-level. It centralizes common Mastra setup such as gateway-backed model access, agent construction helpers, non-streaming/streaming helpers, and reusable MCP registrations. Product-specific agents and prompts should stay in the consuming app.

## Goals

- Keep provider and model routing consistent across apps
- Expose reusable Mastra helpers without baking in app behavior
- Provide MCP registration primitives for optional tool integrations
- Keep package consumers free to compose their own agents, memory, and prompts

## Exports

- `@workspace/mastra`
  - `mastra`
  - `gateway`
  - `chat`
  - `generate`
  - `createAgent`
- `@workspace/mastra/chat`
  - streaming chat helper
- `@workspace/mastra/generate`
  - final-answer text generation helper
- `@workspace/mastra/provider`
  - Vercel AI Gateway provider factory
- `@workspace/mastra/agent-factory`
  - shared agent constructor
- `@workspace/mastra/mcp`
  - MCP registry helpers and built-in registrations such as GlitchTip

## Package Structure

- `src/provider.ts`
  - OpenAI-compatible provider pointed at Vercel AI Gateway
- `src/chat.ts`
  - streaming response helper built on `ai.streamText`
- `src/generate.ts`
  - non-streaming final-text helper built on `ai.generateText`
- `src/agent-factory.ts`
  - creates Mastra agents with a shared gateway-backed model
- `src/mcp/registry.ts`
  - env validation and MCP client construction
- `src/mcp/glitchtip.ts`
  - reusable GlitchTip MCP registration

## Environment

The shared provider reads:

- `AI_GATEWAY_BASE_URL`
- `AI_GATEWAY_API_KEY`

The bundled GlitchTip MCP registration reads:

- `GLITCHTIP_TOKEN`
- `GLITCHTIP_ORGANIZATION`
- `GLITCHTIP_BASE_URL` optional

This package does not load env files by itself. The consuming app is responsible for loading env before creating agents or MCP clients.

## Usage

Create a shared agent with app-specific instructions:

```ts
import { createAgent } from "@workspace/mastra/agent-factory"

const agent = createAgent({
  name: "repochat",
  instructions: "You are a codebase exploration assistant.",
})
```

Use the final-answer helper:

```ts
import { generate } from "@workspace/mastra/generate"

const result = await generate({
  messages: [{ role: "user", content: "Explain this module." }],
})
```

Use the streaming helper:

```ts
import { chat } from "@workspace/mastra/chat"

const result = chat({
  messages: [{ role: "user", content: "Explain this module." }],
})
```

## MCP

The package exposes reusable MCP registration primitives rather than app-specific tool wiring.

Current built-in registration:

- `glitchtip`

Example:

```ts
import { buildMCPClient, glitchtip } from "@workspace/mastra/mcp"

const client = buildMCPClient([glitchtip])
const tools = await client.getTools()
```

The registry validates required env vars up front and throws `MCPConfigError` when configuration is incomplete.

## Design Boundary

Keep in this package:

- provider setup
- generic agent construction
- reusable MCP registrations
- generic streaming / generation helpers

Do not keep in this package:

- app-specific prompts
- product-specific memory policy
- product-specific tool invocation rules
- adapter-specific chat behavior

Those belong in the consuming app, such as `apps/repochat`.

## Tests

```bash
pnpm --filter @workspace/mastra test
pnpm --filter @workspace/mastra typecheck
```

## Notes

- Default model routing currently uses Vercel AI Gateway
- The package is suitable as a reusable Mastra foundation for multiple apps
- Consumers should decide whether to stream responses or only use final answers
