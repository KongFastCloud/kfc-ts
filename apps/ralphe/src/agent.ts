import { Console, Effect } from "effect"
import type { CheckFailure, FatalError } from "./errors.js"
import { Engine, type AgentResult } from "./engine/Engine.js"

export interface AgentOptions {
  readonly feedback?: string | undefined
}

export const agent = (
  task: string,
  opts?: AgentOptions,
): Effect.Effect<AgentResult, CheckFailure | FatalError, Engine> =>
  Effect.gen(function* () {
    const engine = yield* Engine

    let prompt = task
    if (opts?.feedback) {
      prompt += `\n\nPrevious attempt failed:\n${opts.feedback}`
    }

    yield* Console.log(`Running agent...`)
    const result = yield* engine.execute(prompt, process.cwd())
    yield* Console.log(`Agent done.`)

    return result
  })
