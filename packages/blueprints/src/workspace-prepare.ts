/**
 * ABOUTME: Reusable workspace-prepare pipeline for worktree bootstrap.
 * Composes three hard-gated stages in strict order:
 *   1. Ensure worktree exists on the correct branch
 *   2. Copy git-ignored artifacts from source workspace
 *   3. Bootstrap install (lockfile-aware dependency installation)
 *
 * Each stage is a hard gate — failure in any stage terminates the pipeline
 * and surfaces explicit error details via FatalError. The pipeline is
 * tracker-agnostic and app-agnostic; callers decide failure recording policy.
 *
 * ## Design invariants
 *
 * - All inputs are explicit — no defaults to process.cwd().
 * - No tracker, epic, or Beads semantics.
 * - Caller provides worktree path, branch, and source workspace.
 * - Structured result returned on success for caller introspection.
 * - FatalError propagated on any stage failure (no partial results).
 */

import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { ensureWorktree } from "./workspace.js"
import { copyIgnored, type CopyIgnoredResult } from "./copy.js"
import { bootstrapInstall } from "./bootstrap.js"

// ---------------------------------------------------------------------------
// Input / Output contracts
// ---------------------------------------------------------------------------

/**
 * Input contract for the workspace-prepare pipeline.
 */
export interface WorkspacePrepareInput {
  /** Absolute path for the worktree directory. */
  readonly worktreePath: string
  /** Branch name to checkout in the worktree. */
  readonly branch: string
  /** Absolute path to the source workspace for copy-ignored. */
  readonly sourceWorkspace: string
  /**
   * Optional cwd for git worktree commands (defaults to process cwd when
   * omitted). Typically the main repository root.
   */
  readonly sourceCwd?: string | undefined
}

/**
 * Output contract for a successful workspace-prepare pipeline run.
 */
export interface WorkspacePrepareResult {
  /** Absolute path to the prepared worktree. */
  readonly worktreePath: string
  /** Result of the copy-ignored stage. */
  readonly copyResult: CopyIgnoredResult
  /** The stage that completed last (always "bootstrap" on full success). */
  readonly completedStage: "ensure" | "copy-ignored" | "bootstrap"
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Prepare a workspace by executing three hard-gated stages in order:
 *
 * 1. **Ensure worktree** — create, reuse, or recreate the worktree so it
 *    exists on the correct branch.
 * 2. **Copy ignored** — copy git-ignored artifacts (envs, caches, build
 *    output) from the source workspace into the worktree, respecting
 *    `.worktreeinclude` when present.
 * 3. **Bootstrap install** — run lockfile-aware dependency installation
 *    in the worktree. Skipped (no-op) when `package.json` is absent.
 *
 * Each stage is a hard gate: failure terminates the pipeline immediately
 * with a `FatalError` containing explicit error details.
 *
 * @param input - Explicit pipeline inputs (paths, branch, source).
 * @returns A structured result on success, or FatalError on any stage failure.
 */
export const workspacePrepare = (
  input: WorkspacePrepareInput,
): Effect.Effect<WorkspacePrepareResult, FatalError> =>
  Effect.gen(function* () {
    // Stage 1: Ensure worktree
    const resolvedPath = yield* ensureWorktree(
      input.worktreePath,
      input.branch,
      input.sourceCwd,
    )

    // Stage 2: Copy ignored artifacts
    const copyResult = yield* copyIgnored(
      input.sourceWorkspace,
      resolvedPath,
    )

    // Stage 3: Bootstrap install
    yield* bootstrapInstall(resolvedPath)

    return {
      worktreePath: resolvedPath,
      copyResult,
      completedStage: "bootstrap" as const,
    }
  }).pipe(
    Effect.annotateLogs({
      worktreePath: input.worktreePath,
      branch: input.branch,
      sourceWorkspace: input.sourceWorkspace,
    }),
    Effect.withLogSpan("workspace-prepare"),
  )
