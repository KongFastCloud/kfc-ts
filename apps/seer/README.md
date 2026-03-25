# seer

Chat-first codebase exploration service that runs in the same Coder instance as the repository.

`seer` currently exposes a Google Chat webhook backed by the Vercel Chat SDK (`chat`), routes incoming messages through an Effect-based boundary, and answers with a Mastra-backed agent using Vercel AI Gateway. The SDK owns payload parsing, event dispatch, and per-thread serialization. GlitchTip MCP tools are loaded at startup when the required environment variables are present.

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

## Setup

Seer is an HTTP service, not a browser UI. The local URL is for the running server inside your workspace. Chat platforms such as Google Chat should call the externally reachable HTTPS version of the webhook endpoint.

Typical setup flow:

1. Copy env and fill in secrets.
2. Start `seer` in the workspace.
3. Expose the server through your Coder workspace URL, tunnel, or reverse proxy.
4. Configure Google Chat to send interaction events to the HTTPS webhook URL.
5. Add the Chat app to a space and test it.

## Architecture

- `src/index.ts`
  - boots the HTTP server and loads env from `.env.local` or `.env`
- `src/handler.ts`
  - routes HTTP requests to health, SDK webhook, or branch-update handlers
- `src/bot.ts`
  - Chat SDK instance and event handlers; bridges Google Chat into the Effect/Mastra pipeline
- `src/chat.ts`
  - Effect boundary around the Mastra agent call
- `src/agent.ts`
  - seer-specific Mastra agent composition and prompt
- `src/identity.ts`
  - platform-qualified thread and user id helpers
- `src/memory.ts`
  - Mastra memory configuration
- `src/mcp.ts`
  - optional GlitchTip MCP client creation
- `src/runtime.ts`
  - shared Effect runtime and startup-time tool binding

## Memory Storage

Seer uses local LibSQL for durable memory persistence. Both thread message history and resource-scoped working memory survive process restarts.

### How it works

- **Storage backend:** Local LibSQL (SQLite-compatible) via `@mastra/libsql`
- **Database location:** `./data/memory.db` relative to the working directory (default)
- **Override:** Set `SEER_MEMORY_DB_URL` to a `file:` URL to change placement
- **Auto-init:** The parent directory is created automatically on first startup
- **Scope:** Single-process, single-file — no remote database or replication

### What is persisted

| Data | Scope | Survives restart? |
|------|-------|-------------------|
| Thread message history | Per-thread (last 20 messages) | Yes |
| Working memory (user context) | Per-resource (cross-thread) | Yes |
| Thread serialization | Managed by Chat SDK (in-memory) | No |

### Configuration

The storage URL must be a local `file:` path. Remote URLs (`libsql://`, `https://`) and in-memory (`:memory:`) are rejected at startup.

```bash
# Default (no env var needed):
#   file:./data/memory.db

# Custom path:
SEER_MEMORY_DB_URL=file:/var/data/seer/memory.db
```

### Fresh workspace

On first startup in a new workspace:
1. The parent directory for the database file is created recursively
2. LibSQL initializes the schema (tables for threads, messages, resources)
3. No seed data is required — the agent starts with empty memory

### Operational notes

- The database file grows as conversations accumulate. For local development this is negligible.
- To reset all memory, delete the database file and restart.
- Corrupted database files will cause runtime errors on read/write operations. Delete and restart to recover.
- The `data/` directory is gitignored — memory state is local to each workspace.

## Identity Model

Seer qualifies ids by platform before passing them into memory:

- thread id: `gchat:<raw-thread-id>`
- user id: `gchat:<raw-user-id>`

This gives:

- thread-local history inside one conversation
- resource-scoped working memory across threads for the same user
- no accidental cross-platform leakage if Discord or other adapters are added later

## Environment

Copy the example file and fill in values:

```bash
cd apps/seer
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

If the GlitchTip vars are missing, seer still starts and serves normal codebase chat without error-inspection tools.

You will also likely want to decide on:

- the external HTTPS base URL that Google Chat can reach
- the repo path that seer should treat as its working checkout
- the tracked branch seer should sync and reindex
- the codemogger index db path if you do not want the default location

Repository grounding env:

- `SEER_REPO_ROOT`
  - absolute path to the repo checkout seer should read and index
  - defaults to the current working directory
- `SEER_TRACKED_BRANCH`
  - branch seer should sync and watch for reindexing
  - defaults to `main`
- `CODEMOGGER_DB_PATH`
  - optional custom path for the codemogger SQLite db
  - if unset, codemogger uses its default project-local location

## Run

```bash
pnpm --filter seer dev
```

Production-style start:

```bash
pnpm --filter seer start
```

Default local URL:

```text
http://localhost:4320
```

Example health check:

```bash
curl http://localhost:4320/health
```

Expected response:

```json
{
  "ok": true,
  "service": "seer"
}
```

## Google Chat Setup

Seer is implemented as an interactive Google Chat app backed by an HTTP endpoint.

High-level steps:

1. Create a dedicated Google Cloud project for the Chat app.
2. Configure the OAuth consent screen if your organization requires it.
3. Enable the Google Chat API.
4. Configure the Chat app in the Google Chat API settings.
5. Point the app at your external HTTPS webhook URL.
6. Restrict visibility while testing.
7. Add the app to a Chat space or direct message and verify replies.

### 1. Run seer and expose it over HTTPS

Start the service locally in the workspace:

```bash
pnpm --filter seer start
```

Example with explicit repo grounding config:

```bash
SEER_REPO_ROOT=/absolute/path/to/repo \
SEER_TRACKED_BRANCH=main \
pnpm --filter seer start
```

Then expose it through your workspace URL, tunnel, or reverse proxy.

Google Chat requires an HTTPS endpoint for interactive HTTP apps, so the URL you configure in Google Cloud should look like:

```text
https://<your-public-base-url>/google-chat/webhook
```

### 2. Create and configure the Google Chat app

In Google Cloud:

1. Create a Google Cloud project for the Chat app.
2. Enable the Google Chat API.
3. Open the Chat API configuration page.
4. Set the app display name, avatar, and description.
5. Under interactive features:
   - enable messaging functionality
   - enable joining spaces and group conversations if you want the bot to be addable to spaces
6. Under connection settings:
   - choose `HTTP endpoint URL`
   - enter your external HTTPS endpoint:
     - `https://<your-public-base-url>/google-chat/webhook`
7. While testing, set visibility to only yourself or a small test group.
8. Save the configuration.

### 3. Add the app in Google Chat

Once configured:

1. Open Google Chat.
2. Add the app to a direct message or space.
3. Send a message to the app or @mention it in a space.
4. Verify that seer logs the request and responds.

Seer currently handles:

- `MESSAGE`
- `ADDED_TO_SPACE`
- `REMOVED_FROM_SPACE`

### 4. Operational notes

- Google Chat can retry delivery when your endpoint times out, fails, or returns a non-2xx status.
- Synchronous responses should return quickly.
- Seer currently returns a direct JSON response rather than posting asynchronous follow-up messages through the Chat API.
- If you later add asynchronous Chat API calls, you may need app authentication or additional Google auth setup. The current synchronous interaction-response path does not require separate Google auth inside seer.

Official references:

- [Receive and respond to interaction events](https://developers.google.com/workspace/chat/receive-respond-interactions)
- [Configure the Google Chat API](https://developers.google.com/workspace/chat/configure-chat-api)
- [Authenticate and authorize Chat apps and Google Chat API requests](https://developers.google.com/workspace/chat/authenticate-authorize)

## Tests

Run the package tests:

```bash
pnpm --filter seer test
pnpm --filter seer test:integration
pnpm --filter seer typecheck
```

## Current Behavior

- Google Chat is the only adapter currently wired
- Replies are final-answer only
- Card-based Google Chat responses are not implemented
- Per-thread serialization is handled by the Chat SDK (in-memory, single-process)
- GlitchTip is read-only and user-invoked through the agent prompt/tools

## Notes

- Repo facts should come from codebase access and tools, not working memory
- Working memory is reserved for user context and conversational continuity
- The Chat SDK's in-memory state adapter is suitable for one local process; replace it before multi-instance deployment
