# Verification Report: Reuse and extend @workspace/mastra for seer agent orchestration

**Date:** 2026-03-24
**Status:** PASS

## Summary

All acceptance criteria are met. The implementation correctly separates generic Mastra primitives in `@workspace/mastra` from seer-specific agent composition in the app layer, with Effect-based orchestration at the service boundary.

## Acceptance Criteria Verification

### 1. seer can invoke a Mastra-backed agent for an incoming Google Chat message
**PASS** — The Google Chat adapter (`apps/seer/src/adapters/google-chat.ts`) handles MESSAGE events by:
- Extracting `argumentText` (stripped @mention) or falling back to `message.text`
- Qualifying thread/user IDs with platform prefix (`gchat:`)
- Calling `generateReply()` via the Effect managed runtime
- Returning the agent's text reply in the Google Chat response format

Integration tests (13/13 passing) confirm the full webhook → chat bridge → agent path works.

### 2. Vercel AI Gateway is the configured model backend
**PASS** — `packages/mastra/src/provider.ts` configures the gateway via `@ai-sdk/openai-compatible`:
```
baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://gateway.ai.vercel.app/v1"
```
Default model: `anthropic/claude-sonnet-4-6`. The `createAgent` factory wires this gateway automatically.

### 3. @workspace/mastra is reused and only extended with generic reusable primitives
**PASS** — The mastra package exports only generic, reusable primitives:
- `provider.ts` — Vercel AI Gateway provider configuration
- `chat.ts` — Streaming chat via AI SDK `streamText()`
- `generate.ts` — Non-streaming generation via AI SDK `generateText()`
- `agent-factory.ts` — Generic `createAgent()` factory with gateway wiring

No seer-specific code exists in the package. All 20 mastra tests pass.

### 4. seer-specific agent composition remains in the app layer
**PASS** — `apps/seer/src/agent.ts` defines:
- The seer system prompt
- The `AgentService` interface (narrow contract)
- The concrete `seerAgent` instance via `createAgent()` from the shared package
- An Effect `Context.Tag` for dependency injection

### 5. App-facing orchestration uses Effect for logging, tracing, and typed failures
**PASS** — The implementation uses Effect throughout the app boundary:
- `chat.ts`: `Effect.gen` with `Effect.tryPromise` to bridge Mastra Promises → Effect
- `runtime.ts`: `ManagedRuntime` with `Layer` composition for DI
- `errors.ts`: Typed errors (`AgentError`, `PayloadError`) using `Data.TaggedError`
- Structured logging via `Effect.logInfo` with `annotateLogs` for threadId and replyLength
- Logger layer with `Logger.withLeveledConsole(Logger.logfmtLogger)`

Mastra internals are NOT forced into Effect — only the app boundary uses it.

### 6. The chat response returns only the final answer
**PASS** — `generateReply()` calls `agent.generate()` (non-streaming) and returns `{ text: result.text }`. The Google Chat adapter maps this to `{ text, thread }` — only the final answer text is sent back.

## Test Results

### @workspace/mastra (Vitest)
- 5 test files, 20 tests — **all passing**
- Duration: 352ms

### seer unit tests (Node.js test runner)
- 7 suites, 16 tests — **all passing**
- Duration: 380ms

### seer integration tests (Google Chat adapter)
- 2 suites, 13 tests — **all passing**
- Duration: 291ms

### TypeScript
- `@workspace/mastra typecheck` — **clean** (no errors)
- `seer typecheck` — **clean** (no errors)

## Architecture Summary

```
Google Chat Webhook
    ↓
apps/seer/src/adapters/google-chat.ts  (platform adapter)
    ↓
apps/seer/src/chat.ts                  (Effect service boundary)
    ↓
apps/seer/src/agent.ts                 (app-layer agent composition)
    ↓
packages/mastra/src/agent-factory.ts       (generic createAgent factory)
    ↓
packages/mastra/src/provider.ts            (Vercel AI Gateway)
```

## Conclusion

The implementation correctly establishes the chat-to-agent path with clean separation of concerns: Vercel AI Gateway at the ingress, Effect at the application boundary, and Mastra as the reasoning subsystem. All tests pass and types check cleanly.
