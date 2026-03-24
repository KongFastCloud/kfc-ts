import { Effect, Layer, pipe } from "effect"
import type { LoopEvent } from "./loop.js"
import { ClaudeEngineLayer } from "./engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./engine/CodexEngine.js"
import { Engine, type AgentResult } from "./engine/Engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { addComment } from "./beads.js"
import { withSpan } from "./telemetry.js"
import type { GitMode, RalpheConfig } from "./config.js"
import type { TaskResult } from "./TaskResult.js"
import { defaultGitOps, buildCiGitStep, executePostLoopGitOps } from "./gitWorkflow.js"

// Re-export from canonical locations for backward compatibility
export type { TaskResult } from "./TaskResult.js"
export { type GitOps, buildCiGitStep, executePostLoopGitOps } from "./gitWorkflow.js"

export const resolveGitMode = (
  config: RalpheConfig,
  gitModeOverride?: GitMode,
): GitMode =>
  gitModeOverride ?? config.git.mode

/**
 * Format the session comment for a given engine and resume token.
 */
export const formatSessionComment = (
  engine: "claude" | "codex",
  attempt: number,
  maxAttempts: number,
  resumeToken: string | undefined,
): string => {
  if (!resumeToken) {
    return `[attempt ${attempt}/${maxAttempts}] agent completed (no session id)`
  }
  const resumeCmd =
    engine === "codex"
      ? `codex resume ${resumeToken}`
      : `claude --resume ${resumeToken}`
  return `[attempt ${attempt}/${maxAttempts}] ${resumeCmd}`
}

/**
 * Format a check_failed comment for the activity log.
 */
export const formatCheckFailedComment = (
  attempt: number,
  maxAttempts: number,
  feedback: string,
): string =>
  `[attempt ${attempt}/${maxAttempts}] check failed — ${feedback}`

/**
 * Format a success comment for the activity log.
 */
export const formatSuccessComment = (
  attempt: number,
  maxAttempts: number,
): string =>
  `[attempt ${attempt}/${maxAttempts}] all checks passed`

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
    readonly issueId?: string
  },
): Effect.Effect<TaskResult, never> => {
  const engineChoice = opts?.engineOverride ?? config.engine
  const gitMode = resolveGitMode(config, opts?.gitModeOverride)
  const issueId = opts?.issueId

  const engineLayer: Layer.Layer<Engine> =
    engineChoice === "codex" ? CodexEngineLayer : ClaudeEngineLayer

  // Track the last resume token seen from agent execution
  let lastResumeToken: string | undefined

  const ops = defaultGitOps

  const workflow = loop(
    (feedback, attempt, maxAttempts) => {
      let pipeline: Effect.Effect<unknown, any, Engine> = withSpan(
        "agent.execute",
        undefined,
        agent(task, { feedback }),
      ).pipe(
        Effect.tap((result: AgentResult) => {
          lastResumeToken = result.resumeToken
          return Effect.void
        }),
        // Write session comment when running under watcher (issueId present)
        Effect.tap((result: AgentResult) => {
          if (!issueId) return Effect.void
          const comment = formatSessionComment(engineChoice, attempt, maxAttempts, result.resumeToken)
          return addComment(issueId, comment)
        }),
      )
      for (const check of config.checks) {
        pipeline = pipe(pipeline, Effect.andThen(
          withSpan("check.run", { "check.name": check },
            cmd(check).pipe(Effect.annotateLogs({ "check.name": check })),
          ),
        ))
      }
      if (config.report !== "none") {
        pipeline = pipe(pipeline, Effect.andThen(withSpan("report.verify", undefined, report(task, config.report))))
      }
      if (gitMode === "commit_and_push_and_wait_ci") {
        pipeline = pipe(pipeline, Effect.andThen(buildCiGitStep(ops)))
      }
      return pipeline
    },
    {
      maxAttempts: config.maxAttempts,
      spanAttributes: {
        engine: engineChoice,
        ...(issueId ? { "issue.id": issueId } : {}),
      },
      onEvent: (event: LoopEvent) => {
        if (!issueId) return Effect.void
        switch (event.type) {
          case "check_failed": {
            const comment = formatCheckFailedComment(event.attempt, event.maxAttempts, event.feedback ?? "")
            return addComment(issueId, comment)
          }
          case "success": {
            const comment = formatSuccessComment(event.attempt, event.maxAttempts)
            return addComment(issueId, comment)
          }
          default:
            return Effect.void
        }
      },
    },
  )

  const fullWorkflow = Effect.gen(function* () {
    yield* Effect.provide(workflow, engineLayer)
    yield* Effect.provide(executePostLoopGitOps(gitMode, ops), engineLayer)

    return {
      success: true,
      resumeToken: lastResumeToken,
      engine: engineChoice,
    } satisfies TaskResult
  }).pipe(Effect.annotateLogs({ gitMode, engine: engineChoice }))

  // Wrap in an OTel task.run span for Axiom export (proof-of-life)
  const spanAttributes: Record<string, string | number> = { engine: engineChoice }
  if (issueId) spanAttributes["issue.id"] = issueId

  return withSpan("task.run", spanAttributes, fullWorkflow).pipe(
    Effect.catchTag("FatalError", (err) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Task failed: ${err.message}`)
        return {
          success: false,
          resumeToken: lastResumeToken,
          engine: engineChoice,
          error: err.message,
        } satisfies TaskResult
      }),
    ),
  )
}
