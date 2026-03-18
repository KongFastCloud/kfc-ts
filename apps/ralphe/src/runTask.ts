import { Effect, Layer, pipe } from "effect"
import { ClaudeEngineLayer } from "./engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./engine/CodexEngine.js"
import { Engine, type AgentResult } from "./engine/Engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { gitCommitAndPush } from "./git.js"
import type { RalpheConfig } from "./config.js"

export interface TaskResult {
  readonly success: boolean
  readonly resumeToken?: string | undefined
  readonly engine: "claude" | "codex"
  readonly error?: string | undefined
}

/**
 * Shared task executor used by both direct CLI runs and Beads watcher runs.
 * Runs the full pipeline: agent → checks → report → loop with retries → optional auto-commit.
 */
export const runTask = (
  task: string,
  config: RalpheConfig,
  opts?: { readonly engineOverride?: "claude" | "codex" },
): Effect.Effect<TaskResult, never> => {
  const engineChoice = opts?.engineOverride ?? config.engine

  const engineLayer: Layer.Layer<Engine> =
    engineChoice === "codex" ? CodexEngineLayer : ClaudeEngineLayer

  // Track the last resume token seen from agent execution
  let lastResumeToken: string | undefined

  const workflow = loop(
    (feedback) => {
      let pipeline: Effect.Effect<unknown, any, Engine> = agent(task, { feedback }).pipe(
        Effect.tap((result: AgentResult) => {
          lastResumeToken = result.resumeToken
          return Effect.void
        }),
      )
      for (const check of config.checks) {
        pipeline = pipe(pipeline, Effect.andThen(cmd(check)))
      }
      if (config.report !== "none") {
        pipeline = pipe(pipeline, Effect.andThen(report(task, config.report)))
      }
      return pipeline
    },
    { maxAttempts: config.maxAttempts },
  )

  const fullWorkflow = Effect.gen(function* () {
    yield* Effect.provide(workflow, engineLayer)

    if (config.autoCommit) {
      yield* Effect.provide(gitCommitAndPush(), engineLayer)
    }

    return {
      success: true,
      resumeToken: lastResumeToken,
      engine: engineChoice,
    } satisfies TaskResult
  })

  return fullWorkflow.pipe(
    Effect.catchTag("FatalError", (err) =>
      Effect.succeed({
        success: false,
        resumeToken: lastResumeToken,
        engine: engineChoice,
        error: err.message,
      } satisfies TaskResult),
    ),
  )
}
