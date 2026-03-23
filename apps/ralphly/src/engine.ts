/**
 * ABOUTME: Claude engine implementation for ralphly using the blueprints Engine interface.
 * Wraps the Claude Agent SDK query() call and adapts it to the blueprints Engine contract.
 * This is ralphly's default execution backend — callers can substitute a different
 * Engine layer for testing or alternative backends.
 */

import { Effect, Layer } from "effect"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { Engine, type AgentResult, FatalError } from "@workspace/blueprints"

// ---------------------------------------------------------------------------
// Engine implementation
// ---------------------------------------------------------------------------

const make: Engine = {
  execute: (prompt, workDir) =>
    Effect.tryPromise({
      try: async () => {
        let response = ""
        let sessionId: string | undefined

        for await (const message of query({
          prompt,
          options: {
            cwd: workDir,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
          },
        })) {
          if (message.type === "result" && "session_id" in message) {
            sessionId = message.session_id
          }

          if (
            message.type === "result" &&
            message.subtype === "success" &&
            "result" in message
          ) {
            response = message.result
          }
        }

        return { response, sessionId }
      },
      catch: (error) =>
        new FatalError({
          command: "claude",
          message: `Claude agent SDK error: ${error}`,
        }),
    }).pipe(
      Effect.tap((result) =>
        result.sessionId
          ? Effect.logInfo(
              `Resume this Claude session with: claude --resume ${result.sessionId}`,
            )
          : Effect.void,
      ),
      Effect.map(
        ({ response, sessionId }) =>
          ({ response, resumeToken: sessionId }) satisfies AgentResult,
      ),
    ),
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

/** Engine layer that uses the Claude Agent SDK for execution. */
export const ClaudeEngineLayer: Layer.Layer<Engine> = Layer.succeed(Engine, make)
