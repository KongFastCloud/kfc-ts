import { Effect, Layer } from "effect"
import { FatalError } from "../errors.js"
import { Engine, type AgentResult } from "./Engine.js"

const make: Engine = {
  execute: (prompt, workDir) =>
    Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(
          ["codex", "exec", "--full-auto", "--json", prompt],
          { cwd: workDir, stdout: "pipe", stderr: "pipe" },
        )

        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const exitCode = await proc.exited

        if (exitCode !== 0) {
          throw { _tag: "nonzero", stderr, exitCode }
        }

        // Parse JSONL output — collect the last assistant message
        let response = ""
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === "message" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "output_text") {
                  response = block.text
                }
              }
            }
          } catch {
            // Use raw stdout as fallback if not JSONL
            response = stdout
          }
        }

        return { response } satisfies AgentResult
      },
      catch: (error) => {
        if (
          error &&
          typeof error === "object" &&
          "_tag" in error &&
          error._tag === "nonzero"
        ) {
          const e = error as unknown as { stderr: string; exitCode: number }
          return new FatalError({
            command: "codex",
            message: `Codex exited with code ${e.exitCode}: ${e.stderr}`,
          })
        }
        return new FatalError({
          command: "codex",
          message: `Failed to spawn codex: ${error}`,
        })
      },
    }),
}

export const CodexEngineLayer = Layer.succeed(Engine, make)
