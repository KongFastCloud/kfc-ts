import { Agent } from "@mastra/core/agent";
import { gateway } from "./provider.ts";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export interface AgentOptions {
  /** Unique agent name. */
  readonly name: string;
  /** System instructions for the agent. */
  readonly instructions: string;
  /** Model string routed through Vercel AI Gateway. Defaults to Claude Sonnet. */
  readonly model?: string;
}

/**
 * Create a Mastra Agent backed by the Vercel AI Gateway.
 *
 * This factory wires the shared gateway provider so every agent gets
 * consistent model routing without repeating boilerplate.
 *
 * Agent-specific concerns (tools, memory, prompts) are passed via
 * `options` and stay with the caller.
 */
export function createAgent(opts: AgentOptions): Agent {
  return new Agent({
    name: opts.name,
    instructions: opts.instructions,
    model: gateway(opts.model ?? DEFAULT_MODEL),
  });
}

export type { Agent } from "@mastra/core/agent";
