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
 * This module is the authoritative source for epic-level worktree path
 * derivation and lifecycle operations. It delegates generic worktree
 * mechanics to @workspace/blueprints workspace primitives and owns only
 * the epic-specific identity mapping and policy.
 */

import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"
import type { EpicContext } from "./epic.js"
import {
  sanitizeWorkspaceId,
  getRepoRoot as blueprintsGetRepoRoot,
  ensureWorktree,
  getWorktreeState,
  isWorkspaceDirty,
  removeWorktreeWithCleanup,
} from "@workspace/blueprints"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Directory name for the global ralphe worktree root, placed as a sibling
 * of the repository's `.git` directory. Not configurable in this slice.
 */
const WORKTREE_DIR_NAME = ".ralphe-worktrees"

// ---------------------------------------------------------------------------
// Path derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Sanitize an epic ID for use as a directory name.
 * Delegates to the blueprints workspace primitive.
 */
export const sanitizeEpicId = (epicId: string): string =>
  sanitizeWorkspaceId(epicId)

/**
 * Get the git repository root directory.
 */
export const getRepoRoot = (): Effect.Effect<string, FatalError> =>
  blueprintsGetRepoRoot()

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
// Worktree lifecycle (delegates to blueprints)
// ---------------------------------------------------------------------------

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
    return yield* ensureWorktree(worktreePath, epic.branch)
  }).pipe(
    Effect.annotateLogs({ epicId: epic.id, epicBranch: epic.branch }),
  )

// ---------------------------------------------------------------------------
// Worktree state (for TUI display)
// ---------------------------------------------------------------------------

/**
 * Tri-state worktree status for TUI display.
 * - `not_started`: no worktree exists for this epic yet
 * - `clean`: worktree exists and has no uncommitted changes
 * - `dirty`: worktree exists and has uncommitted changes
 */
export type EpicWorktreeState = "not_started" | "clean" | "dirty"

/**
 * Get the operational worktree state for an epic.
 * Used by the TUI to derive the epic display status.
 *
 * Returns `not_started` when no worktree directory exists,
 * `clean` when the worktree exists with no uncommitted changes,
 * and `dirty` when the worktree has staged or unstaged changes.
 */
export const getEpicWorktreeState = (
  epicId: string,
): Effect.Effect<EpicWorktreeState, FatalError> =>
  Effect.gen(function* () {
    const worktreePath = yield* deriveEpicWorktreePath(epicId)
    const state = yield* getWorktreeState(worktreePath)

    // Map blueprints WorktreeState to ralphe EpicWorktreeState
    switch (state) {
      case "not_found":
        return "not_started" as const
      case "clean":
        return "clean" as const
      case "dirty":
        return "dirty" as const
    }
  })

// ---------------------------------------------------------------------------
// Worktree dirty detection
// ---------------------------------------------------------------------------

/**
 * Check whether an epic worktree has uncommitted changes (staged or unstaged).
 * Returns `true` when the worktree exists and is dirty. Returns `false` when
 * the worktree does not exist or is clean.
 */
export const isEpicWorktreeDirty = (
  epicId: string,
): Effect.Effect<boolean, FatalError> =>
  Effect.gen(function* () {
    const worktreePath = yield* deriveEpicWorktreePath(epicId)
    return yield* isWorkspaceDirty(worktreePath)
  })

// ---------------------------------------------------------------------------
// Worktree cleanup
// ---------------------------------------------------------------------------

/**
 * Result of an epic worktree cleanup operation.
 */
export interface EpicWorktreeCleanupResult {
  /** Whether a worktree was actually removed (false when no worktree existed). */
  readonly removed: boolean
  /** Whether the worktree had uncommitted changes at the time of removal. */
  readonly wasDirty: boolean
  /** The path of the removed worktree (undefined when nothing was removed). */
  readonly worktreePath?: string | undefined
}

/**
 * Remove the epic worktree. Used during epic closure to clean up the
 * isolated workspace.
 *
 * Cleanup proceeds even when the worktree is dirty — the `--force` flag
 * is used to ensure removal succeeds. When the worktree is dirty, a warning
 * is emitted so operators can later understand that uncommitted changes
 * were discarded.
 *
 * This is a simple immediate operation — no second cleanup-state machine.
 * If the worktree does not exist, this is a no-op that returns successfully.
 */
export const removeEpicWorktree = (
  epicId: string,
): Effect.Effect<EpicWorktreeCleanupResult, FatalError> =>
  Effect.gen(function* () {
    const worktreePath = yield* deriveEpicWorktreePath(epicId)
    return yield* removeWorktreeWithCleanup(worktreePath)
  }).pipe(
    Effect.annotateLogs({ epicId }),
  )
