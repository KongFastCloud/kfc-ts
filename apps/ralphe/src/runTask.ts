import { Console, Effect, Layer, pipe } from "effect"
import { ClaudeEngineLayer } from "./engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./engine/CodexEngine.js"
import { Engine, type AgentResult } from "./engine/Engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { gitCommit, gitPush, gitWaitForCi } from "./git.js"
import type { GitMode, RalpheConfig } from "./config.js"

export interface TaskResult {
  readonly success: boolean
  readonly resumeToken?: string | undefined
  readonly engine: "claude" | "codex"
  readonly error?: string | undefined
}

export const resolveGitMode = (
  config: RalpheConfig,
  gitModeOverride?: GitMode,
): GitMode =>
  gitModeOverride ?? config.git.mode

/**
 * Shared task executor used by both direct CLI runs and Beads watcher runs.
 * Runs the full pipeline: agent → checks → report → loop with retries → git mode flow.
 */
export const runTask = (
  task: string,
  config: RalpheConfig,
  opts?: {
    readonly engineOverride?: "claude" | "codex"
    readonly gitModeOverride?: GitMode
  },
): Effect.Effect<TaskResult, never> => {
  const engineChoice = opts?.engineOverride ?? config.engine
  const gitMode = resolveGitMode(config, opts?.gitModeOverride)

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
      if (gitMode === "commit_and_push_and_wait_ci") {
        pipeline = pipe(
          pipeline,
          Effect.andThen(
            Effect.gen(function* () {
              const commitResult = yield* gitCommit()
              if (!commitResult) {
                yield* Console.log("Push/CI skipped: no commit created.")
                return
              }

              yield* Console.log(`Commit hash: ${commitResult.hash}`)
              const pushResult = yield* gitPush()
              yield* Console.log(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
              const ciResult = yield* gitWaitForCi()
              yield* Console.log(`CI passed: run ${ciResult.runId}`)
            }),
          ),
        )
      }
      return pipeline
    },
    { maxAttempts: config.maxAttempts },
  )

  const fullWorkflow = Effect.gen(function* () {
    yield* Effect.provide(workflow, engineLayer)

    yield* Console.log(`Git mode: ${gitMode}`)
    switch (gitMode) {
      case "none":
      case "commit_and_push_and_wait_ci":
        break
      case "commit": {
        const commitResult = yield* Effect.provide(gitCommit(), engineLayer)
        if (commitResult) {
          yield* Console.log(`Commit hash: ${commitResult.hash}`)
        }
        break
      }
      case "commit_and_push": {
        const commitResult = yield* Effect.provide(gitCommit(), engineLayer)
        if (!commitResult) {
          yield* Console.log("Push skipped: no commit created.")
          break
        }

        yield* Console.log(`Commit hash: ${commitResult.hash}`)
        const pushResult = yield* gitPush()
        yield* Console.log(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
        break
      }
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
