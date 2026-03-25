/**
 * ABOUTME: Epic worktree lifecycle module.
 * Manages the creation, reuse, and recreation of git worktrees
 * that provide per-epic workspace isolation.
 *
 * Each epic owns exactly one canonical branch and one canonical worktree.
 * Worktree paths are derived deterministically from epic identity under
 * a fixed global ralphe worktree root. The first runnable child task
 * lazily creates the worktree; later tasks reuse it. If a worktree is
 * missing (e.g. manually deleted), it is recreated from the epic's
 * canonical branch.
 *
 * This module is the authoritative source for worktree path derivation
 * and lifecycle operations.
 */

import path from "node:path"
import fs from "node:fs"
import { Effect } from "effect"
import { FatalError } from "./errors.js"
import type { EpicContext } from "./epic.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Directory name for the global ralphe worktree root, placed as a sibling
 * of the repository's `.git` directory. Not configurable in this slice.
 */
const WORKTREE_DIR_NAME = ".ralphe-worktrees"

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
// Path derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Sanitize an epic ID for use as a directory name.
 * Replaces any character that is not alphanumeric, underscore, hyphen, or
 * dot with an underscore. This prevents path traversal and filesystem issues.
 */
export const sanitizeEpicId = (epicId: string): string =>
  epicId.replace(/[^a-zA-Z0-9_.-]/g, "_")

/**
 * Get the git repository root directory.
 */
export const getRepoRoot = (): Effect.Effect<string, FatalError> =>
  runGit(["rev-parse", "--show-toplevel"])

/**
 * Get the global ralphe worktree root path.
 * This is the fixed directory under which all epic worktrees are created.
 */
export const getWorktreeRoot = (): Effect.Effect<string, FatalError> =>
  getRepoRoot().pipe(
    Effect.map((root) => path.join(root, WORKTREE_DIR_NAME)),
  )

/**
 * Derive the canonical worktree path for an epic.
 * The path is deterministic: `{repo_root}/.ralphe-worktrees/{sanitized_epic_id}`
 *
 * This is a pure derivation — it does not check whether the directory exists.
 */
export const deriveEpicWorktreePath = (epicId: string): Effect.Effect<string, FatalError> =>
  getWorktreeRoot().pipe(
    Effect.map((root) => path.join(root, sanitizeEpicId(epicId))),
  )

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

/**
 * Check whether a worktree directory exists and contains a valid git linkage.
 * A valid worktree has a `.git` file (not directory) that links back to the
 * main repository.
 */
const worktreeExistsAt = (worktreePath: string): boolean => {
  const gitPath = path.join(worktreePath, ".git")
  try {
    const stat = fs.statSync(gitPath)
    // Worktrees have a .git file (not directory) containing the gitdir path
    return stat.isFile()
  } catch {
    return false
  }
}

/**
 * Get the current branch of a worktree.
 */
const getWorktreeBranch = (worktreePath: string): Effect.Effect<string, FatalError> =>
  runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)

/**
 * Remove a stale worktree and recreate it on the correct branch.
 * Used when a worktree exists but is on the wrong branch.
 */
const recreateWorktree = (
  worktreePath: string,
  branch: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    yield* Effect.logWarning(`Worktree at ${worktreePath} is on wrong branch. Recreating...`)
    // Remove the stale worktree via git
    yield* runGit(["worktree", "remove", "--force", worktreePath])
    // Prune any dangling worktree references
    yield* runGit(["worktree", "prune"])
    // Recreate on the correct branch
    yield* createWorktree(worktreePath, branch)
  })

/**
 * Create a new git worktree at the given path for the given branch.
 * Ensures the parent directory exists and prunes stale worktree references
 * before creation.
 */
const createWorktree = (
  worktreePath: string,
  branch: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath)
    fs.mkdirSync(parentDir, { recursive: true })

    // Prune stale worktree entries so git doesn't complain about
    // paths that were previously used but whose directories were
    // manually deleted.
    yield* runGit(["worktree", "prune"])

    // Create the worktree. Uses the branch directly — the branch must
    // already exist (created during epic setup).
    yield* runGit(["worktree", "add", worktreePath, branch])
  })

/**
 * Ensure the epic worktree exists, creating it lazily if missing.
 *
 * Lifecycle:
 * 1. Derive the canonical worktree path from epic identity.
 * 2. If the worktree exists and is on the correct branch, reuse it.
 * 3. If the worktree exists but is on the wrong branch, recreate it.
 * 4. If the worktree does not exist, create it from the epic's canonical branch.
 *
 * Returns the absolute path to the worktree directory, suitable for use
 * as the execution cwd.
 */
export const ensureEpicWorktree = (
  epic: EpicContext,
): Effect.Effect<string, FatalError> =>
  Effect.gen(function* () {
    const worktreePath = yield* deriveEpicWorktreePath(epic.id)

    if (worktreeExistsAt(worktreePath)) {
      // Worktree exists — verify it's on the correct branch
      const currentBranch = yield* getWorktreeBranch(worktreePath)

      if (currentBranch === epic.branch) {
        yield* Effect.logInfo(`Reusing epic worktree at ${worktreePath} (branch: ${epic.branch})`)
        return worktreePath
      }

      // Branch mismatch — recreate the worktree
      yield* recreateWorktree(worktreePath, epic.branch)
      yield* Effect.logInfo(`Recreated epic worktree at ${worktreePath} (branch: ${epic.branch})`)
      return worktreePath
    }

    // Worktree does not exist — create it lazily
    yield* createWorktree(worktreePath, epic.branch)
    yield* Effect.logInfo(`Created epic worktree at ${worktreePath} (branch: ${epic.branch})`)
    return worktreePath
  }).pipe(
    Effect.annotateLogs({ epicId: epic.id, epicBranch: epic.branch }),
  )
