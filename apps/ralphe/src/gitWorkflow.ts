/**
 * ABOUTME: Git workflow helpers for the run path.
 * Owns GitOps (DI contract for git operations), buildCiGitStep (in-loop
 * commit+push+wait_ci), executePostLoopGitOps (post-loop git dispatch),
 * and defaultGitOps (real implementations).
 *
 * Used by both the direct run path (buildRunWorkflow) and watch mode (runTask).
 */

import { Effect } from "effect"
import type { GitMode } from "./config.js"
import type { CheckFailure, FatalError } from "./errors.js"
import { Engine } from "./engine/Engine.js"
import { gitCommit, gitPush, gitWaitForCi } from "./git.js"
import type { GitCommitResult, GitPushResult, GitHubCiResult } from "./git.js"
import { withSpan } from "./telemetry.js"

/**
 * Git operation callbacks for dependency injection.
 * Allows tests to provide fake implementations without module mocking.
 */
export interface GitOps {
  readonly commit: () => Effect.Effect<GitCommitResult | undefined, FatalError, Engine>
  readonly push: () => Effect.Effect<GitPushResult, FatalError>
  readonly waitCi: () => Effect.Effect<GitHubCiResult, FatalError | CheckFailure>
}

export const defaultGitOps: GitOps = {
  commit: gitCommit,
  push: gitPush,
  waitCi: gitWaitForCi,
}

/**
 * Build the in-loop git step for commit_and_push_and_wait_ci mode.
 * Commits, pushes, and waits for CI. Returns CheckFailure on CI failure
 * so the retry loop can feed structured annotations back to the agent.
 */
export const buildCiGitStep = (
  ops: GitOps,
): Effect.Effect<void, FatalError | CheckFailure, Engine> =>
  Effect.gen(function* () {
    const commitResult = yield* withSpan("git.commit", undefined, ops.commit())
    if (!commitResult) {
      yield* Effect.logInfo("Push/CI skipped: no commit created.")
      return
    }

    yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
    const pushResult = yield* withSpan("git.push", undefined, ops.push())
    yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
    const ciResult = yield* withSpan("git.wait_ci", undefined, ops.waitCi())
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
        const commitResult = yield* withSpan("git.commit", undefined, ops.commit())
        if (commitResult) {
          yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        }
        break
      }
      case "commit_and_push": {
        const commitResult = yield* withSpan("git.commit", undefined, ops.commit())
        if (!commitResult) {
          yield* Effect.logInfo("Push skipped: no commit created.")
          break
        }

        yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        const pushResult = yield* withSpan("git.push", undefined, ops.push())
        yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
        break
      }
    }
  })
