/**
 * ABOUTME: App-owned workflow builder for the direct run path.
 * This is the single place where direct-run step ordering is defined.
 * Composes blueprints primitives (agent, cmd, loop, report, git ops)
 * explicitly, resolving collaborators through Effect services (EngineResolver,
 * RunObserver) rather than a mixed config bag.
 *
 * The workflow builder receives a pure-data RunRequest and returns a
 * TaskResult. All lifecycle side effects are routed through RunObserver.
 */

import { Effect, pipe } from "effect"
import type { LoopEvent } from "./loop.js"
import type { AgentResult } from "./engine/Engine.js"
import { Engine } from "./engine/Engine.js"
import { agent } from "./agent.js"
import { cmd } from "./cmd.js"
import { loop } from "./loop.js"
import { report } from "./report.js"
import { buildCiGitStep, executePostLoopGitOps, defaultGitOps, type GitOps } from "./gitWorkflow.js"
import type { RunRequest } from "./RunRequest.js"
import { RunObserver } from "./RunObserver.js"
import { EngineResolver } from "./EngineResolver.js"
import type { TaskResult } from "./TaskResult.js"
import type { CheckFailure, FatalError } from "./errors.js"

/**
 * Build and execute the direct-run workflow from a pure-data RunRequest.
 *
 * This is the only place where direct-run step ordering is declared:
 *   1. Resolve engine via EngineResolver service
 *   2. Notify observer of start
 *   3. Loop: agent → checks → report → git (if CI mode)
 *   4. Post-loop git ops
 *   5. Notify observer of completion
 *   6. Shape and return TaskResult
 *
 * @param request - Pure-data per-invocation request
 * @param gitOpsOverride - Optional git ops for testing (defaults to real implementations)
 */
export const buildRunWorkflow = (
  request: RunRequest,
  gitOpsOverride?: GitOps,
): Effect.Effect<TaskResult, never, EngineResolver | RunObserver> => {
  let lastResumeToken: string | undefined
  const ops = gitOpsOverride ?? defaultGitOps

  const workflow = Effect.gen(function* () {
    const resolver = yield* EngineResolver
    const observer = yield* RunObserver
    const engineLayer = resolver.resolve(request.engine)

    yield* observer.onStart(request)

    // ---------------------------------------------------------------------------
    // Build the retry loop body: agent → checks → report → git (CI mode)
    // ---------------------------------------------------------------------------

    const loopWorkflow = loop(
      (feedback, attempt, maxAttempts) => {
        // Step 1: Agent execution
        let pipeline: Effect.Effect<unknown, CheckFailure | FatalError, Engine> = agent(request.task, { feedback }).pipe(
          Effect.withSpan("agent.execute"),
        ).pipe(
          Effect.tap((result: AgentResult) => {
            lastResumeToken = result.resumeToken
            return observer.onAgentResult(result, attempt, maxAttempts)
          }),
        )

        // Step 2: Verification checks
        for (const check of request.checks) {
          pipeline = pipe(
            pipeline,
            Effect.andThen(
              cmd(check).pipe(
                Effect.annotateLogs({ "check.name": check }),
                Effect.withSpan("check.run", { attributes: { "check.name": check } }),
              ),
            ),
          )
        }

        // Step 3: Report verification
        if (request.reportMode !== "none") {
          pipeline = pipe(
            pipeline,
            Effect.andThen(
              report(request.task, request.reportMode).pipe(Effect.withSpan("report.verify")),
            ),
          )
        }

        // Step 4: In-loop git step (CI mode only)
        if (request.gitMode === "commit_and_push_and_wait_ci") {
          pipeline = pipe(pipeline, Effect.andThen(buildCiGitStep(ops)))
        }

        return pipeline
      },
      {
        maxAttempts: request.maxAttempts,
        spanAttributes: { engine: request.engine },
        onEvent: (event: LoopEvent) => observer.onLoopEvent(event),
      },
    )

    // ---------------------------------------------------------------------------
    // Execute loop + post-loop git, catch FatalError into TaskResult
    // ---------------------------------------------------------------------------

    const result = yield* Effect.gen(function* () {
      yield* Effect.provide(loopWorkflow, engineLayer)
      yield* Effect.provide(executePostLoopGitOps(request.gitMode, ops), engineLayer)

      return {
        success: true,
        resumeToken: lastResumeToken,
        engine: request.engine,
      } satisfies TaskResult
    }).pipe(
      Effect.catchTag("FatalError", (err) =>
        Effect.gen(function* () {
          yield* Effect.logError(`Task failed: ${err.message}`)
          return {
            success: false,
            resumeToken: lastResumeToken,
            engine: request.engine,
            error: err.message,
          } satisfies TaskResult
        }),
      ),
    )

    yield* observer.onComplete(result)
    return result
  }).pipe(
    Effect.annotateLogs({ gitMode: request.gitMode, engine: request.engine }),
  )

  // Wrap in an OTel task.run span
  return workflow.pipe(Effect.withSpan("task.run", { attributes: { engine: request.engine } }))
}
