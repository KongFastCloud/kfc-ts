/**
 * Seer memory configuration.
 *
 * Wires Mastra Memory with:
 *   - Thread-local message history for conversational continuity
 *   - Resource-scoped working memory for durable user-level context
 *
 * Identity rules:
 *   - `thread` = platform-qualified thread id (e.g. "gchat:spaces/X/threads/Y")
 *   - `resource` = platform-qualified user id (e.g. "gchat:users/112233")
 *
 * Platform-qualified IDs prevent cross-platform memory leakage by default.
 * A Google Chat user "gchat:users/123" and a future Discord user
 * "discord:users/123" are treated as separate resources with no shared
 * state unless explicit account linking is added (out of scope for v1).
 *
 * Non-goals:
 *   - Semantic recall / embeddings (semanticRecall: false)
 *   - Repo facts as durable memory state
 *   - Account linking across platforms
 */

import { Memory } from "@mastra/memory"
import type { MemoryConfig } from "@mastra/core/memory"
import { createLocalLibSQLStorage } from "@workspace/mastra/storage/libsql"

/**
 * Working memory template — resource-scoped.
 *
 * Persists across threads for the same platform user. The LLM fills in
 * and updates these fields as it learns about the user over time.
 *
 * This is NOT the source of truth for repo facts; it captures durable
 * user-level preferences and context only.
 */
const WORKING_MEMORY_TEMPLATE = `\
# User Context
Preferred name: <unknown>
Repos of interest: <none>
Communication style: <not yet determined>
Key topics discussed: <none>
Open questions or follow-ups: <none>`

/** Memory configuration shared between agent construction and call site. */
export const MEMORY_CONFIG: MemoryConfig = {
  lastMessages: 20,
  semanticRecall: false,
  workingMemory: {
    enabled: true,
    scope: "resource",
    template: WORKING_MEMORY_TEMPLATE,
  },
}

/**
 * Local LibSQL storage URL for durable memory persistence.
 *
 * Defaults to `file:./data/memory.db` relative to the working directory.
 * Override via SEER_MEMORY_DB_URL to control placement explicitly.
 */
const MEMORY_DB_URL =
  process.env.SEER_MEMORY_DB_URL ?? "file:./data/memory.db"

/** LibSQL-backed durable storage for thread history and working memory. */
const storage = createLocalLibSQLStorage({
  url: MEMORY_DB_URL,
})

/** Concrete Memory instance for the seer agent. */
export const memory = new Memory({
  storage,
  options: MEMORY_CONFIG,
})
