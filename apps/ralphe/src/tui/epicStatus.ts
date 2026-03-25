/**
 * ABOUTME: Pure epic display status derivation for the watch TUI.
 * Derives the operational epic display items from tasks, worktree states,
 * and the local deletion queue. This module contains no side effects —
 * all inputs are pre-computed by the controller.
 *
 * Epic display statuses:
 * - not_started: no epic worktree exists yet (lazy creation pending)
 * - dirty: epic worktree exists and has uncommitted changes
 * - queued_for_deletion: operator marked the epic for deletion/cleanup
 *
 * The "clean" worktree state (exists, no uncommitted changes) is not
 * surfaced as a dedicated TUI status — it is implicit in the absence
 * of the other statuses. For TUI purposes, a clean worktree means the
 * epic is simply "active" with no special indicator needed, but since
 * the PRD requires exactly three statuses, clean maps to not_started=false
 * dirty=false, so we show no status badge (displayed as a dash or blank).
 *
 * Actually, re-reading the PRD: the three statuses are the only ones.
 * A clean epic worktree is just a normal state — no special status shown.
 * We display it as "active" since the worktree exists and is healthy.
 */

import type { WatchTask } from "../beadsAdapter.js"
import type { EpicWorktreeState } from "../epicWorktree.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Derived epic display status for the TUI.
 * These are the only statuses shown in the epic pane per the PRD.
 */
export type EpicDisplayStatus =
  | "not_started"
  | "active"
  | "dirty"
  | "queued_for_deletion"

/**
 * A single epic item shaped for TUI rendering.
 */
export interface EpicDisplayItem {
  /** Epic issue ID. */
  readonly id: string
  /** Epic title. */
  readonly title: string
  /** Derived display status. */
  readonly status: EpicDisplayStatus
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Predicate: is this task an epic issue?
 * Epics are identified by the presence of the "epic" label.
 */
export const isEpicTask = (task: WatchTask): boolean =>
  task.labels?.includes("epic") === true

/**
 * Derive the display status for a single epic.
 *
 * Priority order:
 * 1. If the epic is in the deletion queue → queued_for_deletion
 * 2. If the worktree is dirty → dirty
 * 3. If no worktree exists → not_started
 * 4. Otherwise (worktree exists, clean) → active
 */
export const deriveEpicDisplayStatus = (
  epicId: string,
  worktreeState: EpicWorktreeState | undefined,
  deletionQueuedIds: ReadonlySet<string>,
): EpicDisplayStatus => {
  if (deletionQueuedIds.has(epicId)) return "queued_for_deletion"

  switch (worktreeState) {
    case "dirty":
      return "dirty"
    case "not_started":
    case undefined:
      return "not_started"
    case "clean":
      return "active"
  }
}

/**
 * Derive the full set of epic display items from the task list,
 * worktree states, and deletion queue.
 *
 * Includes:
 * - All open epics (status !== "done")
 * - Closed epics that are queued for deletion (still visible until cleanup)
 *
 * Excludes:
 * - Closed epics that are NOT queued for deletion (cleanup complete)
 */
export const deriveEpicDisplayItems = (
  tasks: readonly WatchTask[],
  worktreeStates: ReadonlyMap<string, EpicWorktreeState>,
  deletionQueuedIds: ReadonlySet<string>,
): EpicDisplayItem[] => {
  const items: EpicDisplayItem[] = []

  for (const task of tasks) {
    if (!isEpicTask(task)) continue

    // Include open epics always
    const isOpen = task.status !== "done"
    // Include closed epics only if they are queued for deletion
    const isClosedButQueued = task.status === "done" && deletionQueuedIds.has(task.id)

    if (!isOpen && !isClosedButQueued) continue

    items.push({
      id: task.id,
      title: task.title,
      status: deriveEpicDisplayStatus(
        task.id,
        worktreeStates.get(task.id),
        deletionQueuedIds,
      ),
    })
  }

  return items
}

/**
 * Filter epic-labeled tasks out of a task list.
 * Used to prevent epics from appearing in the task pane (they belong
 * in the epic pane only).
 */
export const excludeEpicTasks = (tasks: readonly WatchTask[]): WatchTask[] =>
  tasks.filter((t) => !isEpicTask(t))
