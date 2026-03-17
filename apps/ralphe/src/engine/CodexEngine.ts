import { Console, Effect, Layer } from "effect"
import { FatalError } from "../errors.js"
import { Engine, type AgentResult } from "./Engine.js"

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const parseCodexExecOutput = (stdout: string): AgentResult & { readonly threadId?: string | undefined } => {
  let response = ""
  let threadId: string | undefined
  let sawJson = false

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue

    let event: JsonRecord | undefined
    try {
      event = JSON.parse(line) as JsonRecord
      sawJson = true
    } catch {
      continue
    }

    const eventType = asString(event.type)
    if (!eventType) continue

    if (eventType === "thread.started") {
      threadId = asString(event.thread_id) ?? threadId
      continue
    }

    if (eventType === "message") {
      const message = asRecord(event.message)
      const content = Array.isArray(message?.content) ? message.content : []
      for (const block of content) {
        const typedBlock = asRecord(block)
        if (typedBlock?.type === "output_text" && asString(typedBlock.text)) {
          response = asString(typedBlock.text) ?? response
        }
      }
      continue
    }

    if (eventType === "item.completed") {
      const item = asRecord(event.item)
      if (item?.type === "agent_message" && asString(item.text)) {
        response = asString(item.text) ?? response
      }
    }
  }

  return {
    response: sawJson ? response : stdout,
    threadId,
  }
}

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

        return parseCodexExecOutput(stdout)
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
    }).pipe(
      Effect.tap((result) =>
        result.threadId
          ? Console.log(`Resume this Codex session with: codex resume ${result.threadId}`)
          : Effect.void,
      ),
      Effect.map(({ response }) => ({ response }) satisfies AgentResult),
    ),
}

export const CodexEngineLayer = Layer.succeed(Engine, make)
