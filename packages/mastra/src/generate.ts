import { generateText } from "ai";
import { gateway } from "./provider.ts";
import type { CoreMessage } from "ai";

export type GenerateOptions = {
  messages: Array<CoreMessage>;
  model?: string;
  system?: string;
  abortSignal?: AbortSignal;
};

export interface GenerateResult {
  readonly text: string;
}

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

/**
 * Generate a complete text response via Vercel AI Gateway.
 *
 * Non-streaming counterpart to `chat()`. Returns only when the full
 * response is available — use this when the caller only needs the
 * final answer.
 */
export async function generate(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const result = await generateText({
    model: gateway(opts.model ?? DEFAULT_MODEL),
    messages: opts.messages,
    system: opts.system,
    abortSignal: opts.abortSignal,
  });

  return { text: result.text };
}

export { type CoreMessage } from "ai";
