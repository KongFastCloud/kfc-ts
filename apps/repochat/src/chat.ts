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
 *
 * Memory wiring:
 *   - `request.threadId` → `memory.thread` (thread-local history)
 *   - `request.userId`   → `memory.resource` (resource-scoped working memory)
 *
 * Both IDs are platform-qualified (e.g. "gchat:spaces/X/threads/Y")
 * so Mastra memory naturally isolates per-platform state.
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
 *
 * Uses the `memory` option to pass platform-qualified thread and
 * resource identifiers to Mastra, enabling thread-local history and
 * resource-scoped working memory.
 */
export const generateReply = (
  request: ChatRequest,
): Effect.Effect<ChatResponse, AgentError, RepochatAgent> =>
  Effect.gen(function* () {
    const agent = yield* RepochatAgent

    const result = yield* Effect.tryPromise({
      try: () =>
        agent.generate(request.text, {
          memory: {
            thread: request.threadId,
            resource: request.userId,
          },
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
