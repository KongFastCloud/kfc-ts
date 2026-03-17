import { Console, Effect, Layer } from "effect"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { FatalError } from "../errors.js"
import { Engine, type AgentResult } from "./Engine.js"

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
          ? Console.log(`Resume this Claude session with: claude --resume ${result.sessionId}`)
          : Effect.void,
      ),
      Effect.map(({ response }) => ({ response }) satisfies AgentResult),
    ),
}

export const ClaudeEngineLayer = Layer.succeed(Engine, make)
