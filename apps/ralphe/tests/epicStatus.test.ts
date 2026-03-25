/**
 * ABOUTME: Tests for epic display status derivation.
 * Verifies that epics are correctly identified, statuses are derived from
 * worktree state and deletion queue, and display items are computed correctly.
 */

import { describe, it, expect } from "bun:test"
import type { WatchTask } from "../src/beadsAdapter.js"
import type { EpicWorktreeState } from "../src/epicWorktree.js"
import {
  isEpicTask,
  deriveEpicDisplayStatus,
  deriveEpicDisplayItems,
  excludeEpicTasks,
} from "../src/tui/epicStatus.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, status: WatchTask["status"], labels?: string[]): WatchTask {
  return { id, title: `Task ${id}`, status, labels }
}

function makeEpic(id: string, status: WatchTask["status"] = "backlog"): WatchTask {
  return { id, title: `Epic ${id}`, status, labels: ["epic"] }
}

// ---------------------------------------------------------------------------
// isEpicTask
// ---------------------------------------------------------------------------

describe("isEpicTask", () => {
  it("returns true for tasks with the epic label", () => {
    expect(isEpicTask(makeEpic("E-1"))).toBe(true)
  })

  it("returns true when epic is one of several labels", () => {
    expect(isEpicTask(makeTask("T-1", "backlog", ["urgent", "epic", "p1"]))).toBe(true)
  })

  it("returns false for tasks without the epic label", () => {
    expect(isEpicTask(makeTask("T-1", "backlog", ["ready"]))).toBe(false)
  })

  it("returns false for tasks with no labels", () => {
    expect(isEpicTask(makeTask("T-1", "backlog"))).toBe(false)
  })

  it("returns false for tasks with undefined labels", () => {
    expect(isEpicTask({ id: "T-1", title: "t", status: "backlog" })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// deriveEpicDisplayStatus
// ---------------------------------------------------------------------------

describe("deriveEpicDisplayStatus", () => {
  const emptyDeletionSet: ReadonlySet<string> = new Set()

  it("returns queued_for_deletion when epic is in deletion queue (highest priority)", () => {
    const deletionSet = new Set(["E-1"])
    // Even if worktree is dirty, deletion takes precedence
    expect(deriveEpicDisplayStatus("E-1", "dirty", deletionSet)).toBe("queued_for_deletion")
  })

  it("returns dirty when worktree state is dirty", () => {
    expect(deriveEpicDisplayStatus("E-1", "dirty", emptyDeletionSet)).toBe("dirty")
  })

  it("returns not_started when worktree state is not_started", () => {
    expect(deriveEpicDisplayStatus("E-1", "not_started", emptyDeletionSet)).toBe("not_started")
  })

  it("returns not_started when worktree state is undefined", () => {
    expect(deriveEpicDisplayStatus("E-1", undefined, emptyDeletionSet)).toBe("not_started")
  })

  it("returns active when worktree state is clean", () => {
    expect(deriveEpicDisplayStatus("E-1", "clean", emptyDeletionSet)).toBe("active")
  })
})

// ---------------------------------------------------------------------------
// deriveEpicDisplayItems
// ---------------------------------------------------------------------------

describe("deriveEpicDisplayItems", () => {
  const emptyWorktreeStates = new Map<string, EpicWorktreeState>()
  const emptyDeletionSet: ReadonlySet<string> = new Set()

  it("returns empty array when no tasks have the epic label", () => {
    const tasks = [makeTask("T-1", "backlog"), makeTask("T-2", "done")]
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, emptyDeletionSet)
    expect(result).toHaveLength(0)
  })

  it("includes open epics", () => {
    const tasks = [makeEpic("E-1", "backlog"), makeEpic("E-2", "active")]
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, emptyDeletionSet)
    expect(result).toHaveLength(2)
    expect(result.map((e) => e.id)).toEqual(["E-1", "E-2"])
  })

  it("excludes closed epics that are NOT queued for deletion", () => {
    const tasks = [makeEpic("E-1", "done"), makeEpic("E-2", "backlog")]
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, emptyDeletionSet)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("E-2")
  })

  it("includes closed epics that ARE queued for deletion", () => {
    const tasks = [makeEpic("E-1", "done")]
    const deletionSet = new Set(["E-1"])
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, deletionSet)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("E-1")
    expect(result[0]!.status).toBe("queued_for_deletion")
  })

  it("derives status correctly from worktree states", () => {
    const tasks = [
      makeEpic("E-1", "backlog"),
      makeEpic("E-2", "backlog"),
      makeEpic("E-3", "backlog"),
    ]
    const worktreeStates = new Map<string, EpicWorktreeState>([
      ["E-1", "not_started"],
      ["E-2", "clean"],
      ["E-3", "dirty"],
    ])
    const result = deriveEpicDisplayItems(tasks, worktreeStates, emptyDeletionSet)
    expect(result).toHaveLength(3)
    expect(result[0]!.status).toBe("not_started")
    expect(result[1]!.status).toBe("active")
    expect(result[2]!.status).toBe("dirty")
  })

  it("includes title from the task", () => {
    const tasks = [makeEpic("E-1", "backlog")]
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, emptyDeletionSet)
    expect(result[0]!.title).toBe("Epic E-1")
  })

  it("does not include non-epic tasks", () => {
    const tasks = [
      makeTask("T-1", "backlog"),
      makeEpic("E-1", "backlog"),
      makeTask("T-2", "active"),
    ]
    const result = deriveEpicDisplayItems(tasks, emptyWorktreeStates, emptyDeletionSet)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("E-1")
  })

  it("deletion queue takes precedence over worktree state", () => {
    const tasks = [makeEpic("E-1", "backlog")]
    const worktreeStates = new Map<string, EpicWorktreeState>([["E-1", "dirty"]])
    const deletionSet = new Set(["E-1"])
    const result = deriveEpicDisplayItems(tasks, worktreeStates, deletionSet)
    expect(result[0]!.status).toBe("queued_for_deletion")
  })
})

// ---------------------------------------------------------------------------
// excludeEpicTasks
// ---------------------------------------------------------------------------

describe("excludeEpicTasks", () => {
  it("filters out epic-labeled tasks", () => {
    const tasks = [
      makeTask("T-1", "backlog"),
      makeEpic("E-1", "backlog"),
      makeTask("T-2", "active"),
    ]
    const result = excludeEpicTasks(tasks)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(["T-1", "T-2"])
  })

  it("returns all tasks when none are epics", () => {
    const tasks = [makeTask("T-1", "backlog"), makeTask("T-2", "done")]
    const result = excludeEpicTasks(tasks)
    expect(result).toHaveLength(2)
  })

  it("returns empty array when all tasks are epics", () => {
    const tasks = [makeEpic("E-1"), makeEpic("E-2")]
    const result = excludeEpicTasks(tasks)
    expect(result).toHaveLength(0)
  })

  it("returns empty array for empty input", () => {
    expect(excludeEpicTasks([])).toHaveLength(0)
  })
})
