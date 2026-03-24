import {  streamText } from "ai";
import { gateway } from "./provider.ts";
import type {CoreMessage} from "ai";

export type ChatOptions = {
  messages: Array<CoreMessage>;
  model?: string;
  system?: string;
  abortSignal?: AbortSignal;
  onFinish?: (result: { text: string }) => void | Promise<void>;
};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

/**
 * Stream a chat response via Vercel AI Gateway.
 *
 * Returns the AI SDK StreamTextResult which exposes:
 *   - textStream: AsyncIterable of text chunks
 *   - toDataStreamResponse(): Response for SSE endpoints
 */
export function chat({
  messages,
  model = DEFAULT_MODEL,
  system,
  abortSignal,
  onFinish,
}: ChatOptions) {
  return streamText({
    model: gateway(model),
    messages,
    system,
    abortSignal,
    onFinish,
  });
}

export { type CoreMessage } from "ai";
