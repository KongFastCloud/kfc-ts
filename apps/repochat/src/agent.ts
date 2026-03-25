/**
 * Repochat Mastra agent composition.
 *
 * This file defines the repochat-specific agent using the generic
 * `createAgent` factory from @workspace/mastra. The system prompt,
 * agent name, memory wiring, and tool bindings live here — not in
 * the shared package.
 *
 * An Effect Context.Tag is provided so the agent can be injected
 * as a dependency, enabling clean testing without module mocks.
 *
 * Memory policy:
 *   - Thread-local history preserves continuity within a conversation
 *   - Resource-scoped working memory carries user context across threads
 *   - Platform-qualified IDs isolate memory per platform by default
 *   - Repo facts are NOT stored in working memory
 *
 * Tool integrations:
 *   - Codemogger MCP — semantic and keyword code search for codebase
 *     discovery. Primary grounding mechanism for codebase questions.
 *   - read_file — direct file-read for exact source verification after
 *     codemogger retrieval.
 *   - GlitchTip MCP (optional) — read-only issue and event inspection,
 *     user-invoked only. Agent falls back to codebase-only mode when
 *     GlitchTip env vars are not configured.
 */

import { Context } from "effect"
import { createAgent } from "@workspace/mastra/agent-factory"
import type { ToolsInput } from "@mastra/core/agent"
import { memory } from "./memory.ts"

const SYSTEM_PROMPT = [
  "You are Repochat, a codebase exploration assistant.",
  "You help engineers understand a codebase by answering questions about its structure, patterns, and conventions.",
  "Keep answers concise and grounded in actual source code. If you are unsure, say so.",
  "Do not store repository facts (file paths, code snippets, architecture details) in working memory.",
  "Working memory is for user preferences and conversational context only.",
  "",
  "## Codebase grounding",
  "You have access to codemogger for searching the indexed codebase.",
  "Use codemogger search to discover relevant files and code when answering codebase questions.",
  "After finding relevant results via codemogger, use the read_file tool to verify exact source code before quoting it.",
  "Always ground your answers in actual code — do not guess at file contents or structure.",
  "Prefer searching first, then reading specific files, rather than reading files blindly.",
  "",
  "## GlitchTip (production errors)",
  "You also have access to GlitchTip tools for inspecting production errors.",
  "Use GlitchTip tools ONLY when the user explicitly asks about production errors, exceptions, crashes, or GlitchTip issues.",
  "Do not call GlitchTip tools for general codebase questions, architecture discussions, or unrelated conversations.",
  "When using GlitchTip, stick to read-only inspection — listing issues, viewing event details, and summarizing error context.",
].join("\n")

/**
 * The subset of the Mastra Agent interface used at the app boundary.
 *
 * Keeping this narrow makes testing simple (no need to construct a
 * full Agent) and documents the contract explicitly.
 */
export interface AgentService {
  readonly name: string
  generate(
    messages: string | string[],
    opts?: {
      /** @deprecated Use `memory` instead. */
      resourceId?: string
      /** @deprecated Use `memory` instead. */
      threadId?: string
      /** Memory options for thread history and working memory. */
      memory?: {
        thread: string
        resource: string
        options?: Record<string, unknown>
      }
    },
  ): Promise<{ text: string }>
}

/**
 * Build the concrete Mastra Agent instance for repochat.
 *
 * Accepts an optional tools map (e.g. from MCP integrations) so the
 * agent can be created with or without external tool bindings.
 * When no tools are provided the agent operates in codebase-only mode.
 */
export function makeRepochatAgent(tools?: ToolsInput): AgentService {
  return createAgent({
    name: "repochat",
    instructions: SYSTEM_PROMPT,
    memory,
    ...(tools ? { tools } : {}),
  }) as unknown as AgentService
}

/** The concrete Mastra Agent instance for repochat (no MCP tools). */
export const repochatAgent: AgentService = makeRepochatAgent()

/** Effect service tag for the Mastra agent dependency. */
export class RepochatAgent extends Context.Tag("RepochatAgent")<
  RepochatAgent,
  AgentService
>() {}
