/**
 * ABOUTME: Tracker-agnostic workspace lifecycle primitives.
 * Manages the creation, reuse, recreation, and removal of git worktrees
 * that provide per-workspace isolation. These primitives accept explicit
 * inputs and never encode epic/task/Beads semantics.
 *
 * Apps (ralphe, ralphly) compose these primitives with their own domain
 * context resolution and policy. Blueprints owns the git/filesystem
 * mechanics; apps own identity mapping and error surfacing.
 *
 * ## Design invariants
 *
 * - All operations accept explicit paths and branch names — no defaults.
 * - Git side effects are modeled through Effect for composability.
 * - No runtime state, labels, comments, or tracker writes happen here.
 * - Callers derive worktree paths and branches from their own domain model.
 */

import path from "node:path"
import fs from "node:fs"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Git command runner (local to this module)
// ---------------------------------------------------------------------------

/**
 * Run a git command and return stdout. Accepts an optional cwd for
 * commands that need to run inside a specific worktree or repo root.
 */
const runGit = (
  args: string[],
  cwd?: string,
): Effect.Effect<string, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        throw { stderr, exitCode }
      }

      return stdout.trim()
    },
    catch: (error) => {
      if (error && typeof error === "object" && "stderr" in error) {
        const e = error as { stderr: string; exitCode: number }
        return new FatalError({
          command: `git ${args.join(" ")}`,
          message: e.stderr.trim() || `exited with code ${e.exitCode}`,
        })
      }
      return new FatalError({
        command: `git ${args.join(" ")}`,
        message: `Failed to run git: ${error}`,
      })
    },
  })

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a workspace identifier for use as a directory name.
 * Replaces any character that is not alphanumeric, underscore, hyphen, or
 * dot with an underscore. This prevents path traversal and filesystem issues.
 */
export const sanitizeWorkspaceId = (id: string): string =>
  id.replace(/[^a-zA-Z0-9_.-]/g, "_")

/**
 * Get the git repository root directory from a given working directory.
 * If no cwd is provided, uses the process default.
 */
export const getRepoRoot = (cwd?: string): Effect.Effect<string, FatalError> =>
  runGit(["rev-parse", "--show-toplevel"], cwd)

// ---------------------------------------------------------------------------
// Worktree existence check
// ---------------------------------------------------------------------------

/**
 * Check whether a worktree directory exists and contains a valid git linkage.
 * A valid worktree has a `.git` file (not directory) that links back to the
 * main repository. This is a pure synchronous check.
 */
export const worktreeExistsAt = (worktreePath: string): boolean => {
  const gitPath = path.join(worktreePath, ".git")
  try {
    const stat = fs.statSync(gitPath)
    // Worktrees have a .git file (not directory) containing the gitdir path
    return stat.isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Worktree branch detection
// ---------------------------------------------------------------------------

/**
 * Get the current branch of a worktree.
 */
export const getWorktreeBranch = (worktreePath: string): Effect.Effect<string, FatalError> =>
  runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const localBranchExists = (branch: string, cwd?: string): Effect.Effect<boolean, never> =>
  runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).pipe(
    Effect.as(true),
    Effect.catchTag("FatalError", () => Effect.succeed(false)),
  )

// ---------------------------------------------------------------------------
// Worktree lifecycle primitives
// ---------------------------------------------------------------------------

/**
 * Create a new git worktree at the given path for the given branch.
 * Ensures the parent directory exists and prunes stale worktree references
 * before creation.
 *
 * If the branch does not exist locally, it is created from the current HEAD
 * of the source repository.
 *
 * @param worktreePath - Absolute path for the new worktree directory.
 * @param branch - Branch name to checkout in the worktree.
 * @param sourceCwd - Optional cwd for git commands (defaults to process cwd).
 */
export const createWorktree = (
  worktreePath: string,
  branch: string,
  sourceCwd?: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath)
    fs.mkdirSync(parentDir, { recursive: true })

    // Prune stale worktree entries so git doesn't complain about
    // paths that were previously used but whose directories were
    // manually deleted.
    yield* runGit(["worktree", "prune"], sourceCwd)

    const branchExists = yield* localBranchExists(branch, sourceCwd)

    // Create the worktree on the target branch. If the branch has not
    // been materialized locally yet, create it from the current HEAD.
    yield* runGit(
      branchExists
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
      sourceCwd,
    )
  })

/**
 * Remove a worktree and prune dangling references.
 *
 * Uses `--force` to handle dirty worktrees. Callers should check for dirty
 * state before calling if they need to warn or block.
 *
 * @param worktreePath - Absolute path of the worktree to remove.
 * @param sourceCwd - Optional cwd for git commands (defaults to process cwd).
 */
export const removeWorktree = (
  worktreePath: string,
  sourceCwd?: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    yield* runGit(["worktree", "remove", "--force", worktreePath], sourceCwd)
    yield* runGit(["worktree", "prune"], sourceCwd)
  })

/**
 * Remove a stale worktree and recreate it on the correct branch.
 * Used when a worktree exists but is on the wrong branch.
 *
 * @param worktreePath - Absolute path of the worktree to recreate.
 * @param branch - Branch name to checkout in the recreated worktree.
 * @param sourceCwd - Optional cwd for git commands (defaults to process cwd).
 */
export const recreateWorktree = (
  worktreePath: string,
  branch: string,
  sourceCwd?: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    yield* Effect.logWarning(`Worktree at ${worktreePath} is on wrong branch. Recreating...`)
    yield* removeWorktree(worktreePath, sourceCwd)
    yield* createWorktree(worktreePath, branch, sourceCwd)
  })

// ---------------------------------------------------------------------------
// High-level ensure primitive
// ---------------------------------------------------------------------------

/**
 * Ensure a workspace worktree exists at the given path on the given branch.
 *
 * Lifecycle:
 * 1. If the worktree exists and is on the correct branch → reuse.
 * 2. If the worktree exists but is on the wrong branch → recreate.
 * 3. If the worktree does not exist → create.
 *
 * Returns the absolute worktree path (same as input, for chaining convenience).
 *
 * @param worktreePath - Absolute path for the worktree directory.
 * @param branch - Expected branch for the worktree.
 * @param sourceCwd - Optional cwd for git commands (defaults to process cwd).
 */
export const ensureWorktree = (
  worktreePath: string,
  branch: string,
  sourceCwd?: string,
): Effect.Effect<string, FatalError> =>
  Effect.gen(function* () {
    if (worktreeExistsAt(worktreePath)) {
      // Worktree exists — verify it's on the correct branch
      const currentBranch = yield* getWorktreeBranch(worktreePath)

      if (currentBranch === branch) {
        yield* Effect.logInfo(`Reusing worktree at ${worktreePath} (branch: ${branch})`)
        return worktreePath
      }

      // Branch mismatch — recreate the worktree
      yield* recreateWorktree(worktreePath, branch, sourceCwd)
      yield* Effect.logInfo(`Recreated worktree at ${worktreePath} (branch: ${branch})`)
      return worktreePath
    }

    // Worktree does not exist — create it
    yield* createWorktree(worktreePath, branch, sourceCwd)
    yield* Effect.logInfo(`Created worktree at ${worktreePath} (branch: ${branch})`)
    return worktreePath
  })

// ---------------------------------------------------------------------------
// Worktree state detection
// ---------------------------------------------------------------------------

/**
 * Tri-state worktree status.
 * - `not_found`: no valid worktree exists at the path
 * - `clean`: worktree exists and has no uncommitted changes
 * - `dirty`: worktree exists and has uncommitted changes
 */
export type WorktreeState = "not_found" | "clean" | "dirty"

/**
 * Get the operational state of a worktree.
 *
 * @param worktreePath - Absolute path of the worktree to inspect.
 */
export const getWorktreeState = (
  worktreePath: string,
): Effect.Effect<WorktreeState, FatalError> =>
  Effect.gen(function* () {
    if (!worktreeExistsAt(worktreePath)) {
      return "not_found" as const
    }

    const status = yield* runGit(["status", "--porcelain"], worktreePath)
    return status.trim().length > 0 ? ("dirty" as const) : ("clean" as const)
  })

/**
 * Check whether a worktree has uncommitted changes (staged or unstaged).
 * Returns `false` when the worktree does not exist.
 *
 * @param worktreePath - Absolute path of the worktree to inspect.
 */
export const isWorktreeDirty = (
  worktreePath: string,
): Effect.Effect<boolean, FatalError> =>
  Effect.gen(function* () {
    if (!worktreeExistsAt(worktreePath)) {
      return false
    }

    const status = yield* runGit(["status", "--porcelain"], worktreePath)
    return status.trim().length > 0
  })

// ---------------------------------------------------------------------------
// Worktree cleanup with result
// ---------------------------------------------------------------------------

/**
 * Result of a workspace worktree cleanup operation.
 */
export interface WorktreeCleanupResult {
  /** Whether a worktree was actually removed (false when no worktree existed). */
  readonly removed: boolean
  /** Whether the worktree had uncommitted changes at the time of removal. */
  readonly wasDirty: boolean
  /** The path of the removed worktree (undefined when nothing was removed). */
  readonly worktreePath?: string | undefined
}

/**
 * Remove a workspace worktree with cleanup metadata.
 *
 * Cleanup proceeds even when the worktree is dirty — the `--force` flag
 * ensures removal succeeds. When the worktree is dirty, a warning is emitted
 * so callers can understand that uncommitted changes were discarded.
 *
 * If the worktree does not exist, this is a no-op that returns successfully.
 *
 * @param worktreePath - Absolute path of the worktree to remove.
 * @param sourceCwd - Optional cwd for git commands (defaults to process cwd).
 */
export const removeWorktreeWithCleanup = (
  worktreePath: string,
  sourceCwd?: string,
): Effect.Effect<WorktreeCleanupResult, FatalError> =>
  Effect.gen(function* () {
    if (!worktreeExistsAt(worktreePath)) {
      yield* Effect.logInfo(`No worktree to clean up at ${worktreePath}`)
      return { removed: false, wasDirty: false }
    }

    // Check for dirty state before removal so we can warn
    const dirty = yield* isWorktreeDirty(worktreePath)

    if (dirty) {
      yield* Effect.logWarning(
        `Worktree at ${worktreePath} has uncommitted changes. ` +
        `Proceeding with cleanup — uncommitted work will be discarded.`,
      )
    }

    yield* removeWorktree(worktreePath, sourceCwd)

    yield* Effect.logInfo(
      `Removed worktree at ${worktreePath}` +
      (dirty ? " (was dirty — uncommitted changes discarded)" : ""),
    )

    return { removed: true, wasDirty: dirty, worktreePath }
  })
