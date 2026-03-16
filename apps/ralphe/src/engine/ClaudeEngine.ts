import { Effect, Layer } from "effect"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { FatalError } from "../errors.js"
import { Engine, type AgentResult } from "./Engine.js"

const make: Engine = {
  execute: (prompt, workDir) =>
    Effect.tryPromise({
      try: async () => {
        let response = ""

        for await (const message of query({
          prompt,
          options: {
            cwd: workDir,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
          },
        })) {
          if (
            message.type === "result" &&
            message.subtype === "success" &&
            "result" in message
          ) {
            response = message.result
          }
        }

        return { response } satisfies AgentResult
      },
      catch: (error) =>
        new FatalError({
          command: "claude",
          message: `Claude agent SDK error: ${error}`,
        }),
    }),
}

export const ClaudeEngineLayer = Layer.succeed(Engine, make)
