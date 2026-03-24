# Verification Report: Repochat Memory Wiring

**Date:** 2026-03-24
**Feature:** Add repochat memory wiring with thread-local history and working memory
**Status:** PASS

## Acceptance Criteria Verification

### 1. Mastra receives platform-qualified thread and resource ids from repochat
**PASS**

- `apps/repochat/src/identity.ts` defines `qualifyThreadId` and `qualifyUserId` helpers that produce `<platform>:<raw-id>` formatted IDs
- `apps/repochat/src/adapters/google-chat.ts` qualifies IDs at the adapter boundary using `qualifyThreadId("gchat", message.thread.name)` and `qualifyUserId("gchat", message.sender.name)`
- `apps/repochat/src/chat.ts` passes these qualified IDs to the Mastra agent via `memory: { thread: request.threadId, resource: request.userId }`
- Tests verify correct ID format: `"gchat:spaces/SPACE1/threads/THREAD1"`, `"gchat:users/112233"`

### 2. Thread-local history preserves continuity within a Google Chat conversation
**PASS**

- `apps/repochat/src/memory.ts` configures `lastMessages: 20` for thread-scoped message history
- The `thread` field in the memory options maps to the platform-qualified thread ID
- Each Google Chat conversation thread gets its own message history via the qualified thread ID

### 3. Working memory can persist durable user-level context across threads
**PASS**

- Working memory is configured with `enabled: true, scope: "resource"` in `MEMORY_CONFIG`
- The `resource` field maps to the platform-qualified user ID (e.g. `gchat:users/112233`)
- A structured template captures user preferences: preferred name, repos of interest, communication style, key topics, open questions
- Resource-scoping means the same user across different threads shares working memory

### 4. Cross-platform leakage prevented by namespaced identities
**PASS**

- Platform type is `"gchat" | "discord"` — extensible but explicit
- Same raw ID on different platforms produces distinct qualified IDs: `gchat:users/123` vs `discord:users/123`
- Tests explicitly verify `gchat` and `discord` qualified IDs are distinct
- No shared state between platforms without explicit account linking (not implemented, as intended)

### 5. Repo facts are not treated as durable memory state
**PASS**

- System prompt explicitly instructs: "Do not store repository facts (file paths, code snippets, architecture details) in working memory."
- Working memory template contains only user preference fields (preferred name, repos of interest, communication style, key topics, open questions)
- Tests verify the template does not include repo fact fields
- `semanticRecall: false` — no vector embeddings for retrieval

## Test Results

### Repochat Tests (26/26 passing)
- `agent.test.ts`: AgentService interface, agent name, Context.Tag
- `chat.test.ts`: Reply generation, error handling, memory thread/resource passing, no deprecated fields
- `errors.test.ts`: Tagged error hierarchy
- `identity.test.ts`: Platform qualification for gchat, discord, cross-platform isolation
- `memory.test.ts`: Config validation (20-message limit, semantic recall off, working memory enabled/resource-scoped, template content, no repo facts, cross-platform isolation)
- `state.test.ts`: Thread lock serialization

### Mastra Package Tests (22/22 passing)
- `agent-factory.test.ts`: Memory option pass-through, omission when not provided
- `chat.test.ts`, `generate.test.ts`, `provider.test.ts`, `index.test.ts`

### TypeScript Typecheck
Both `repochat` and `@workspace/mastra` pass `tsc --noEmit` cleanly.

## Architecture Summary

```
Google Chat Webhook POST
  → adapters/google-chat.ts (qualifies thread + user IDs with "gchat:" prefix)
  → chat.ts (Effect bridge, passes memory: { thread, resource })
  → agent.ts (Mastra Agent with memory instance)
  → packages/mastra/agent-factory.ts (createAgent with memory)
  → Mastra Memory (thread-local history + resource-scoped working memory)
```

## Key Files
- `apps/repochat/src/memory.ts` — Memory config + working memory template
- `apps/repochat/src/identity.ts` — Platform-qualified ID helpers
- `apps/repochat/src/chat.ts` — Effect bridge with memory wiring
- `apps/repochat/src/agent.ts` — Agent composition with memory injection
- `apps/repochat/src/adapters/google-chat.ts` — Webhook handler with ID qualification
- `packages/mastra/src/agent-factory.ts` — Generic agent factory accepting memory

## Conclusion

All five acceptance criteria are met. The implementation is clean, well-documented, and thoroughly tested. The identity model is extensible to Discord without migration concerns.
