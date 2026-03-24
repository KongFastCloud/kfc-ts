/**
 * ABOUTME: Single-agent execution step.
 * Receives a task string + optional feedback from a previous failure,
 * appends feedback to the prompt, and delegates to the Engine.
 */

import { Effect } from "effect"
import type { CheckFailure, FatalError } from "./errors.js"
import { Engine, type AgentResult } from "./engine.js"

export interface AgentOptions {
  readonly feedback?: string | undefined
}

export const agent = (
  task: string,
  workspace: string,
  opts?: AgentOptions,
): Effect.Effect<AgentResult, CheckFailure | FatalError, Engine> =>
  Effect.gen(function* () {
    const engine = yield* Engine

    let prompt = task
    if (opts?.feedback) {
      prompt += `\n\nPrevious attempt failed:\n${opts.feedback}`
    }

    yield* Effect.logInfo(`Running agent...`)
    const result = yield* engine.execute(prompt, workspace)
    yield* Effect.logInfo(`Agent done.`)

    return result
  }).pipe(Effect.withLogSpan("agent"))
