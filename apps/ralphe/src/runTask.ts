import { Effect, Layer, pipe } from "effect"
import type { LoopEvent } from "./loop.js"
import { ClaudeEngineLayer } from "./engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./engine/CodexEngine.js"
import { Engine, type AgentResult } from "./engine/Engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { gitCommit, gitPush, gitWaitForCi } from "./git.js"
import { addComment } from "./beads.js"
import type { GitMode, RalpheConfig } from "./config.js"
import type { CheckFailure, FatalError } from "./errors.js"
import type { GitCommitResult, GitPushResult, GitHubCiResult } from "./git.js"

export interface TaskResult {
  readonly success: boolean
  readonly resumeToken?: string | undefined
  readonly engine: "claude" | "codex"
  readonly error?: string | undefined
}

/**
 * Git operation callbacks for dependency injection.
 * Allows tests to provide fake implementations without module mocking.
 */
export interface GitOps {
  readonly commit: () => Effect.Effect<GitCommitResult | undefined, FatalError, Engine>
  readonly push: () => Effect.Effect<GitPushResult, FatalError>
  readonly waitCi: () => Effect.Effect<GitHubCiResult, FatalError | CheckFailure>
}

const defaultGitOps: GitOps = {
  commit: gitCommit,
  push: gitPush,
  waitCi: gitWaitForCi,
}

export const resolveGitMode = (
  config: RalpheConfig,
  gitModeOverride?: GitMode,
): GitMode =>
  gitModeOverride ?? config.git.mode

/**
 * Build the in-loop git step for commit_and_push_and_wait_ci mode.
 * Commits, pushes, and waits for CI. Returns CheckFailure on CI failure
 * so the retry loop can feed structured annotations back to the agent.
 */
export const buildCiGitStep = (
  ops: GitOps,
): Effect.Effect<void, FatalError | CheckFailure, Engine> =>
  Effect.gen(function* () {
    const commitResult = yield* ops.commit()
    if (!commitResult) {
      yield* Effect.logDebug("Push/CI skipped: no commit created.")
      return
    }

    yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
    const pushResult = yield* ops.push()
    yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
    const ciResult = yield* ops.waitCi()
    yield* Effect.logInfo(`CI passed: run ${ciResult.runId}`)
  })

/**
 * Execute post-loop git operations based on the git mode.
 * Handles "commit" and "commit_and_push" modes.
 * "none" and "commit_and_push_and_wait_ci" are no-ops here
 * (CI mode runs inside the retry loop via buildCiGitStep).
 */
export const executePostLoopGitOps = (
  gitMode: GitMode,
  ops: GitOps,
): Effect.Effect<void, FatalError, Engine> =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Git mode: ${gitMode}`)
    switch (gitMode) {
      case "none":
      case "commit_and_push_and_wait_ci":
        break
      case "commit": {
        const commitResult = yield* ops.commit()
        if (commitResult) {
          yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        }
        break
      }
      case "commit_and_push": {
        const commitResult = yield* ops.commit()
        if (!commitResult) {
          yield* Effect.logDebug("Push skipped: no commit created.")
          break
        }

        yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        const pushResult = yield* ops.push()
        yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
        break
      }
    }
  })

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
      let pipeline: Effect.Effect<unknown, any, Engine> = agent(task, { feedback }).pipe(
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
        pipeline = pipe(pipeline, Effect.andThen(cmd(check)))
      }
      if (config.report !== "none") {
        pipeline = pipe(pipeline, Effect.andThen(report(task, config.report)))
      }
      if (gitMode === "commit_and_push_and_wait_ci") {
        pipeline = pipe(pipeline, Effect.andThen(buildCiGitStep(ops)))
      }
      return pipeline
    },
    {
      maxAttempts: config.maxAttempts,
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
  }).pipe(Effect.annotateLogs({ gitMode }))

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
