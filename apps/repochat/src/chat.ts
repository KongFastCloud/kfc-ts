/**
 * Chat bridge — Effect service boundary.
 *
 * Wraps the Mastra agent call in Effect for typed error handling,
 * structured logging, and dependency injection. Mastra itself stays
 * as plain Promise-based code; Effect.tryPromise bridges the two
 * worlds at this layer.
 *
 * The adapter layer calls `generateReply` and runs it through the
 * managed runtime to get a plain Promise back.
 */

import { Effect } from "effect"
import { RepochatAgent } from "./agent.ts"
import { AgentError } from "./errors.ts"

export interface ChatRequest {
  readonly threadId: string
  readonly userId: string
  readonly text: string
}

export interface ChatResponse {
  readonly text: string
}

/**
 * Send a user message through the Mastra agent and return the final answer.
 *
 * Requires `RepochatAgent` in the Effect context. Failures from the
 * model/gateway are captured as `AgentError`.
 */
export const generateReply = (
  request: ChatRequest,
): Effect.Effect<ChatResponse, AgentError, RepochatAgent> =>
  Effect.gen(function* () {
    const agent = yield* RepochatAgent

    const result = yield* Effect.tryPromise({
      try: () =>
        agent.generate(request.text, {
          resourceId: request.userId,
          threadId: request.threadId,
        }),
      catch: (cause) =>
        new AgentError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })

    yield* Effect.logInfo("Reply generated").pipe(
      Effect.annotateLogs("threadId", request.threadId),
      Effect.annotateLogs("replyLength", String(result.text.length)),
    )

    return { text: result.text }
  })
