import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Vercel AI Gateway provider.
 *
 * Call with a model string to get a model instance:
 *   gateway("anthropic/claude-sonnet-4-6")
 *   gateway("openai/gpt-4o")
 */
export const gateway = createOpenAICompatible({
  name: "vercel-ai-gateway",
  baseURL:
    process.env.AI_GATEWAY_BASE_URL ?? "https://gateway.ai.vercel.app/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
});
