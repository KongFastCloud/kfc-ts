# PRD: KongFastChat — Universal AI Memory Layer with Chat UI

**Version:** 2.0.0
**Date:** 2026-03-09

---

## Problem Statement

AI-powered tools (Claude Code, Codex, Cursor, Windsurf) and commercial chat apps (ChatGPT, Claude.ai) store conversation data in opaque, provider-locked silos. A developer who uses multiple AI tools daily has no unified view of their AI conversations, no way to query across them, and no path to build downstream automation (memory agents, summarisation, embedding pipelines) on top of that data.

Commercial chat apps do not expose hooks or APIs for conversation export in real time. The only way to own the full conversation history across all AI tools is to build a self-hosted chat interface (for the tools that lack hooks) and an ingestion layer (for the tools that do support hooks, like Claude Code).

---

## Solution

Build KongFastChat: a self-hosted, multi-user chat web application that serves two purposes:

1. **Chat UI** — A model-agnostic chatbot interface where the LLM provider is swappable at runtime via Vercel AI Gateway. This covers tools that lack export/hook support (ChatGPT, Claude.ai equivalents).

2. **Universal memory layer** — An ingestion API that receives conversation data from external AI tools (Claude Code, Codex, Cursor, Windsurf) via hooks. All conversations from all sources land in a single Postgres database, queryable by future memory agents.

The architecture is designed so that the data layer can be upgraded from polling-based sync (TanStack DB + TanStack Query) to real-time sync (Electric SQL) without changing application code.

---

## User Stories

### Chat UI — Core

1. As a user, I want to start a new conversation with a single click, so that my context window is fresh and uncluttered.
2. As a user, I want to see a list of all past conversations in a sidebar, so that I can resume any previous session quickly.
3. As a user, I want conversations in the sidebar sorted by most recently updated, so that my active threads are always at the top.
4. As a user, I want to search across all my past conversations by keyword, so that I can find information I discussed earlier without scrolling through history.
5. As a user, I want to rename a conversation, so that I can organise my history with meaningful titles.
6. As a user, I want to delete a conversation, so that I can remove sessions that are no longer relevant.
7. As a user, I want my messages to stream token-by-token as the model responds, so that I get fast feedback and do not sit staring at a blank screen.
8. As a user, I want to send a message by pressing Enter and start a new line with Shift+Enter, so that the input behaviour matches my expectations from other chat tools.
9. As a user, I want to copy any assistant message to my clipboard with one click, so that I can reuse output without selecting text manually.
10. As a user, I want to regenerate the last assistant response, so that I can get an alternative answer without retyping my prompt.
11. As a user, I want to edit a previous user message and replay the conversation from that point, so that I can correct mistakes without starting over.

### Chat UI — Rendering

12. As a user, I want Markdown rendered in assistant responses (headings, bold, lists, tables, code blocks), so that structured answers are easy to read.
13. As a user, I want syntax highlighting inside code blocks, so that code snippets are readable and easy to copy.
14. As a user, I want a copy button on every code block, so that I can grab code without selecting text manually.

### Model & Provider Management

15. As a user, I want to select which model powers my conversation from a dropdown, so that I can switch between providers without redeploying.
16. As a user, I want to select the model within a conversation (not just in settings), so that I can switch mid-session if needed.
17. As a user, I want to see which model was used for each assistant message, so that I have a clear audit trail when I switch models.
18. As a developer, I want to configure a default model in settings, so that new conversations start with my preferred model without manual selection each time.

### System Prompts

19. As a user, I want to set a system prompt per conversation, so that I can customise the assistant's persona or constraints for different use cases.
20. As a user, I want to set a global default system prompt in settings, so that all new conversations inherit my preferred instructions without manual setup.

### Organisation

21. As a user, I want to pin frequently used conversations, so that they always appear at the top of my sidebar regardless of recency.
22. As a user, I want to tag or label conversations, so that I can group related threads together.
23. As a user, I want to filter the sidebar by tag, so that I can focus on a specific project or topic.

### UI & Responsiveness

24. As a user, I want dark mode and light mode support, so that the interface is comfortable in different lighting conditions.
25. As a user, I want keyboard shortcuts for common actions (new chat, focus input, toggle sidebar), so that I can navigate without reaching for the mouse.
26. As a user, I want the UI to be fully usable on a mobile browser, so that I can access my chatbot from my phone without installing a native app.

### Authentication

27. As a user, I want to sign in with my Google account, so that I can access my conversations securely without creating a new password.
28. As a developer, I want API keys for programmatic access, so that external tools can write to the memory layer without interactive OAuth.
29. As a user, I want to generate and revoke API keys from the settings page, so that I control which tools have access.

### Universal Memory Layer — Ingestion

30. As a developer, I want an HTTP ingestion endpoint that accepts conversation data from external tools, so that Claude Code, Codex, and other tools can write to my memory layer.
31. As a developer, I want the ingestion endpoint to authenticate via API key, so that only authorised tools can write data.
32. As a developer, I want the ingestion endpoint to upsert conversations idempotently, so that duplicate sends from hooks are harmless.
33. As a developer, I want each ingested message to carry a `source` field (e.g. "claude-code", "codex", "web"), so that I can distinguish where conversations originated.
34. As a developer, I want a Claude Code command hook that reads the transcript on the `Stop` event and POSTs it to the ingestion API, so that every Claude Code session is automatically captured.

### Universal Memory Layer — Queryability

35. As a developer, I want conversation content stored as JSON in the database, so that I can query message structure, tool calls, and nested content efficiently.
36. As a developer, I want the database schema to support efficient querying across all conversations regardless of source, so that a future memory agent can search, summarise, and reason over my full AI history.

### Data Persistence & Sync

37. As a developer, I want all conversation turns automatically saved to the database after every exchange, so that no message is lost even if I close the tab mid-conversation.
38. As a developer, I want the client data layer (TanStack DB) to be swappable from polling (TanStack Query) to real-time sync (Electric SQL) without changing UI code, so that I can upgrade the sync strategy later.

### Error Handling

39. As a developer, I want the app to gracefully handle provider API errors (rate limits, network failures) and display a clear error message, so that I understand what went wrong without checking logs.

### Configuration

40. As a developer, I want all configuration (API keys, default model, system prompt) managed through the settings UI and persisted in the database, so that I do not need to edit config files on the server.

---

## Implementation Decisions

### Framework & Deployment

- **Framework:** TanStack Start (Vite-powered), deployed on Vercel Pro with Fluid compute enabled.
- **Routing:** TanStack Router with file-based routing and fully inferred type-safe route params. Core routes: `/` (home/new chat), `/chat/:conversationId` (conversation view), `/settings` (configuration).
- **Monorepo:** Turborepo with pnpm. Four packages: `apps/kongfastchat`, `packages/db`, `packages/ui`, `packages/mastra`.

### Data Layer

- **Database:** Neon Postgres (serverless). Per-feature and per-agent branches for development workflows.
- **ORM:** Drizzle ORM as the single source of truth for all TypeScript types and database schema.
- **Client data:** TanStack DB with `queryCollectionOptions` (backed by TanStack Query with polling). Designed for future swap to `electricCollectionOptions` (backed by Electric SQL) without UI changes.
- **Schema:** Core tables in `public` schema:
  - `conversations` — id (uuid), user_id (references neon_auth.user), title, created_at, updated_at, pinned (boolean), tags (jsonb)
  - `messages` — id (uuid), conversation_id (references conversations), role (enum: user/assistant/system), content (jsonb), source (text, e.g. "web", "claude-code", "codex"), created_at
  - `api_keys` — id (uuid), user_id (references neon_auth.user), key_hash (text), name (text), created_at, revoked_at (nullable timestamp)
- **Message content format:** JSONB column supporting structured content (text, tool calls, images, etc.) for future queryability by memory agents.

### Authentication

- **Web UI:** Neon Auth (managed Better Auth built into Neon) with Google OAuth. Auth tables live in the `neon_auth` schema within the same Neon database. Branch-aware (auth state branches with the database).
- **Agent ingestion:** API key authentication via `Authorization: Bearer <key>` header. Keys are generated from the settings UI, stored as hashed values in the `api_keys` table. Each key is scoped to a user.

### AI / LLM Integration

- **Framework:** Mastra (`packages/mastra`), wrapping the Vercel AI SDK. Chat-only for v1; agent/workflow features deferred.
- **Model routing:** Vercel AI Gateway. Models addressed via string IDs (e.g. `"anthropic/claude-sonnet-4-6"`, `"openai/gpt-4o"`). No markup on token pricing.
- **Streaming:** SSE via AI SDK's `useChat` hook. Tokens stream from Vercel AI Gateway through a TanStack Start server function to the client. On stream completion, the final message is optimistically inserted into the TanStack DB collection and persisted to Neon via Drizzle.
- **Streaming-to-DB handoff:** During generation, the UI renders from the SSE stream buffer. On completion, an optimistic mutation inserts the assistant message into the TanStack DB collection. The next poll confirms persistence. No flicker, no gap.

### UI Components

- **Component library:** shadcn/ui (Radix primitives, CVA variants) in `packages/ui`.
- **AI chat components:** Vercel AI Elements scaffolded into `packages/ui`. Components used: Conversation, Message, PromptInput, CodeBlock, Actions, Reasoning.
- **Markdown rendering:** Streamdown (streaming-optimised, ships with AI Elements).
- **Syntax highlighting:** Shiki (ships with AI Elements).
- **Styling:** Tailwind CSS 4 with CSS variables. Dark/light mode via CSS custom properties.
- **Icons:** Lucide React.

### External Ingestion (Claude Code Hook)

- **Hook type:** Command hook (not HTTP hook), because the hook needs to read the local `transcript_path` file.
- **Hook event:** `Stop` — fires when Claude finishes responding. Provides `session_id`, `last_assistant_message`, and `transcript_path` (local JSONL file).
- **Flow:** Hook script reads transcript JSONL → transforms to canonical message schema → HTTP POST to `/api/ingest` with API key → server upserts conversation and messages idempotently (keyed on session_id + source).
- **Per-tool transformers:** Each external tool (Claude Code, Codex, Cursor) will need its own transformer that maps the tool's native format to the canonical schema. These run in the hook script, not in the server.

### Configuration

- **Provider keys:** Managed via Vercel AI Gateway BYOK (Bring Your Own Key) — keys configured in Vercel team settings, never stored in the app database.
- **App settings:** Default model, global system prompt, and per-conversation settings stored in the database and managed through the settings UI.

---

## Testing Decisions

### What makes a good test

- Tests verify external, observable behaviour — what data comes out of a module given a specific input — not how the module achieves that result internally.
- Tests do not reach into private methods, internal state, or implementation details that are likely to change.
- Each test is independently runnable and does not depend on test ordering or shared mutable state.
- Tests are deterministic; any randomness or time-dependency is controlled via injection or mocking at the boundary.

### Modules to be tested

- **`packages/db` — Drizzle schema / database layer:** Integration tests run against a Neon branch (or local PGlite for CI) to verify that CRUD operations on `conversations`, `messages`, and `api_keys` produce the expected rows, that foreign key constraints are enforced, and that JSONB content queries return correct results.

- **Ingestion API (`/api/ingest`):** Integration tests verify that a POST with valid API key and canonical payload upserts conversations and messages correctly, that duplicate POSTs are idempotent, that invalid API keys are rejected with 401, and that malformed payloads return 400 with a clear error.

### Deferred testing

- Mastra / AI provider tests are deferred to v2 when agent features are added.
- UI component tests are deferred (shadcn/AI Elements are well-tested upstream).
- E2E browser tests (Playwright) are deferred to post-v1 stabilisation.

---

## Out of Scope

- **Agent workflows / memory agents:** Mastra is scaffolded but agent features (tools, workflows, RAG, memory summarisation) are deferred. The schema is designed to support future agent queryability.
- **Electric SQL real-time sync:** v1 uses TanStack DB + Query polling. Electric SQL is the planned upgrade path but not implemented in v1.
- **Token tracking / cost estimates:** Deferred. The schema does not include token_count or cost fields in v1.
- **Vector search / semantic search:** Deferred. Only keyword search in v1.
- **Sharing conversations:** No mechanism to share or publish conversations.
- **Multi-device offline support:** Requires Electric SQL / local-first architecture, deferred.
- **Native mobile app:** Mobile-optimised web app is sufficient.
- **Fine-tuning or model training:** The app consumes LLM APIs only.
- **Self-hosting documentation beyond Vercel:** Only Vercel deployment is documented.
- **Automatic memory summarisation:** Hooks make it possible to trigger externally, but the app does not implement it.
- **Plugin marketplace:** No third-party extension ecosystem.

---

## Further Notes

- **TanStack DB is in beta (v0.5.31).** For a personal/small-user tool, this is an acceptable trade-off. The API is stabilising and the TanStack team actively maintains it. The upgrade path to Electric SQL is a first-class integration.
- **Neon Auth is in beta.** Same trade-off applies. It eliminates auth infrastructure management and provides branch-aware auth for the development workflow.
- **Mastra is included from day one** despite being chat-only in v1. This avoids a painful retrofit when agent features are added. The `packages/mastra` boundary is clean.
- **The ingestion API is the most architecturally important feature.** It is what makes KongFastChat a universal memory layer rather than just another chatbot. The canonical schema and per-tool transformers must be designed for extensibility.
- **Provider API keys are never stored in the app database.** They are managed via Vercel AI Gateway BYOK. This eliminates an entire class of security concerns.
- **Neon branching enables AI-first development workflows.** Agents can work on isolated database branches without risk of corrupting production data. Branch creation/deletion can be automated via Neon CLI tied to git branches.
