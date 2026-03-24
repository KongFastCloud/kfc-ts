/**
 * ABOUTME: Reusable git composition helpers for app-owned workflows.
 * Provides GitMode, GitOps, and combinators for in-loop CI and post-loop
 * git operations. Apps compose these into their own workflow pipelines.
 * Workspace is always an explicit input — no fallback to process.cwd().
 */

import { Effect } from "effect"
import type { CheckFailure, FatalError } from "./errors.js"
import { Engine } from "./engine.js"
import { gitCommit, gitPush, gitWaitForCi } from "./git.js"
import type { GitCommitResult, GitPushResult, GitHubCiResult } from "./git.js"

// ---------------------------------------------------------------------------
// Git mode (apps decide which mode to use)
// ---------------------------------------------------------------------------

/**
 * Git operation mode. Apps choose one of these when assembling their workflow.
 * - "none": No automatic git operations after task completion
 * - "commit": Stage and commit changes but do not push
 * - "commit_and_push": Stage, commit, and push changes
 * - "commit_and_push_and_wait_ci": Stage, commit, push, and wait for CI
 */
export type GitMode =
  | "none"
  | "commit"
  | "commit_and_push"
  | "commit_and_push_and_wait_ci"

// ---------------------------------------------------------------------------
// Git operations (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Git operation callbacks for dependency injection.
 * Allows tests to provide fake implementations without module mocking.
 * Each operation receives the explicit workspace path to execute within.
 */
export interface GitOps {
  readonly commit: (workspace: string) => Effect.Effect<GitCommitResult | undefined, FatalError, Engine>
  readonly push: (workspace: string) => Effect.Effect<GitPushResult, FatalError>
  readonly waitCi: (workspace: string) => Effect.Effect<GitHubCiResult, FatalError | CheckFailure>
}

export const defaultGitOps: GitOps = {
  commit: gitCommit,
  push: gitPush,
  waitCi: gitWaitForCi,
}

// ---------------------------------------------------------------------------
// Git step combinators
// ---------------------------------------------------------------------------

/**
 * Build the in-loop git step for commit_and_push_and_wait_ci mode.
 * Commits, pushes, and waits for CI. Returns CheckFailure on CI failure
 * so the retry loop can feed structured annotations back to the agent.
 *
 * Use this inside a loop body when git mode is "commit_and_push_and_wait_ci".
 */
export const buildCiGitStep = (
  ops: GitOps,
  workspace: string,
): Effect.Effect<void, FatalError | CheckFailure, Engine> =>
  Effect.gen(function* () {
    const commitResult = yield* ops.commit(workspace)
    if (!commitResult) {
      yield* Effect.logDebug("Push/CI skipped: no commit created.")
      return
    }

    yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
    const pushResult = yield* ops.push(workspace)
    yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
    const ciResult = yield* ops.waitCi(workspace)
    yield* Effect.logInfo(`CI passed: run ${ciResult.runId}`)
  })

/**
 * Execute post-loop git operations based on the git mode.
 * Handles "commit" and "commit_and_push" modes.
 * "none" and "commit_and_push_and_wait_ci" are no-ops here
 * (CI mode runs inside the retry loop via buildCiGitStep).
 *
 * Use this after the loop completes to handle non-CI git modes.
 */
export const executePostLoopGitOps = (
  gitMode: GitMode,
  ops: GitOps,
  workspace: string,
): Effect.Effect<void, FatalError, Engine> =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Git mode: ${gitMode}`)
    switch (gitMode) {
      case "none":
      case "commit_and_push_and_wait_ci":
        break
      case "commit": {
        const commitResult = yield* ops.commit(workspace)
        if (commitResult) {
          yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        }
        break
      }
      case "commit_and_push": {
        const commitResult = yield* ops.commit(workspace)
        if (!commitResult) {
          yield* Effect.logDebug("Push skipped: no commit created.")
          break
        }

        yield* Effect.logInfo(`Commit hash: ${commitResult.hash}`)
        const pushResult = yield* ops.push(workspace)
        yield* Effect.logInfo(`Pushed: ${pushResult.remote}/${pushResult.ref}`)
        break
      }
    }
  })
