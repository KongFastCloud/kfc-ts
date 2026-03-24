/**
 * Repochat Mastra agent composition.
 *
 * This file defines the repochat-specific agent using the generic
 * `createAgent` factory from @workspace/mastra. The system prompt,
 * agent name, and any future tool bindings live here — not in the
 * shared package.
 *
 * An Effect Context.Tag is provided so the agent can be injected
 * as a dependency, enabling clean testing without module mocks.
 */

import { Context } from "effect"
import { createAgent } from "@workspace/mastra/agent-factory"

const SYSTEM_PROMPT = [
  "You are Repochat, a codebase exploration assistant.",
  "You help engineers understand a codebase by answering questions about its structure, patterns, and conventions.",
  "Keep answers concise and grounded. If you are unsure, say so.",
].join(" ")

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
    opts?: { resourceId?: string; threadId?: string },
  ): Promise<{ text: string }>
}

/** The concrete Mastra Agent instance for repochat. */
export const repochatAgent: AgentService = createAgent({
  name: "repochat",
  instructions: SYSTEM_PROMPT,
}) as unknown as AgentService

/** Effect service tag for the Mastra agent dependency. */
export class RepochatAgent extends Context.Tag("RepochatAgent")<
  RepochatAgent,
  AgentService
>() {}
