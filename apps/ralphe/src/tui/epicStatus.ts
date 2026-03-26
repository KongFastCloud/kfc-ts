/**
 * ABOUTME: Pure epic display status derivation for the watch TUI.
 * Derives the operational epic display items from tasks, worktree states,
 * and the local deletion queue. This module contains no side effects —
 * all inputs are pre-computed by the controller.
 *
 * Epic display statuses:
 * - error: bootstrap/runtime state for the epic is currently errored
 * - not_started: no epic worktree exists yet (lazy creation pending)
 * - dirty: epic worktree exists and has uncommitted changes
 * - active: epic worktree exists and is clean
 * - queued_for_deletion: operator marked the epic for deletion/cleanup
 */

import type { WatchTask } from "../beadsAdapter.js"
import type { EpicWorktreeState } from "../epicWorktree.js"
import type { EpicRuntimeStatus } from "../epicRuntimeState.js"
import { isEpicIssue } from "../epic.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Derived epic display status for the TUI.
 * These are the only statuses shown in the epic pane per the PRD.
 */
export type EpicDisplayStatus =
  | "error"
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
 * Canonical signal is Beads type `epic`; the legacy `epic` label is still
 * accepted during migration.
 */
export const isEpicTask = (task: WatchTask): boolean =>
  isEpicIssue(task)

/**
 * Derive the display status for a single epic.
 *
 * Priority order:
 * 1. If the epic runtime state is errored → error
 * 2. If the epic is in the deletion queue → queued_for_deletion
 * 3. If the worktree is dirty → dirty
 * 4. If no worktree exists → not_started
 * 5. Otherwise (worktree exists, clean) → active
 */
export const deriveEpicDisplayStatus = (
  epicId: string,
  worktreeState: EpicWorktreeState | undefined,
  runtimeStatus: EpicRuntimeStatus | undefined,
  deletionQueuedIds: ReadonlySet<string>,
): EpicDisplayStatus => {
  if (runtimeStatus === "error") return "error"
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
  runtimeStates: ReadonlyMap<string, EpicRuntimeStatus>,
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
        runtimeStates.get(task.id),
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
