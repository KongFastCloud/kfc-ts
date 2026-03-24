/**
 * Chat bridge.
 *
 * Thin wrapper around @workspace/mastra chat that collects the
 * streamed response into a single final-answer string. This keeps
 * the adapter layer free from streaming concerns — it just gets
 * a complete reply to send back to the platform.
 *
 * Later slices will add Mastra agent wiring, memory, and tool
 * orchestration behind this interface.
 */

import { chat as streamChat, type CoreMessage } from "@workspace/mastra/chat"

const SYSTEM_PROMPT = [
  "You are Repochat, a codebase exploration assistant.",
  "You help engineers understand a codebase by answering questions about its structure, patterns, and conventions.",
  "Keep answers concise and grounded. If you are unsure, say so.",
].join(" ")

export interface ChatRequest {
  readonly threadId: string
  readonly userId: string
  readonly text: string
}

export interface ChatResponse {
  readonly text: string
}

/**
 * Send a user message and return the complete assistant reply.
 *
 * Currently stateless — each call is independent. Thread-local
 * message history and Mastra memory will be added in later slices.
 */
export const generateReply = async (request: ChatRequest): Promise<ChatResponse> => {
  const messages: CoreMessage[] = [{ role: "user", content: request.text }]

  const result = streamChat({ messages, system: SYSTEM_PROMPT })

  const text = await result.text

  return { text }
}
