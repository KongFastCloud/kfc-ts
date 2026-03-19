import { describe, test, expect } from "bun:test"
import {
  parseBdTaskList,
  beadsDatabaseExists,
  getAvailableActions,
  type WatchTask,
} from "../src/beadsAdapter.js"

// ---------------------------------------------------------------------------
// parseBdTaskList
// ---------------------------------------------------------------------------

describe("parseBdTaskList", () => {
  test("parses a full task list", () => {
    const json = JSON.stringify([
      {
        id: "task-1",
        title: "Add login page",
        description: "Create login page",
        status: "open",
        priority: 2,
        labels: ["frontend"],
        owner: "alice",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "task-2",
        title: "Fix API timeout",
        status: "in_progress",
        priority: 1,
      },
      {
        id: "task-3",
        title: "Update docs",
        status: "closed",
        priority: 3,
      },
    ])

    const tasks = parseBdTaskList(json)

    expect(tasks).toHaveLength(3)
    expect(tasks[0]!.id).toBe("task-1")
    expect(tasks[0]!.title).toBe("Add login page")
    expect(tasks[0]!.status).toBe("backlog") // open + no ready label → backlog
    expect(tasks[0]!.description).toBe("Create login page")
    expect(tasks[0]!.priority).toBe(2)
    expect(tasks[0]!.labels).toEqual(["frontend"])
    expect(tasks[0]!.owner).toBe("alice")
    expect(tasks[0]!.createdAt).toBe("2025-01-01T00:00:00Z")

    expect(tasks[1]!.status).toBe("active")
    expect(tasks[2]!.status).toBe("done")
  })

  test("maps cancelled to error status", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Cancelled task", status: "cancelled" },
    ])
    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.status).toBe("error")
  })

  test("maps open with unresolved blocking deps to blocked", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Blocked task",
        status: "open",
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.status).toBe("blocked")
    expect(tasks[0]!.dependsOn).toEqual(["dep-1"])
  })

  test("maps open with resolved blocking deps and no ready label to backlog", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Unready task",
        status: "open",
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
        ],
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.status).toBe("backlog")
  })

  test("maps open with resolved blocking deps and ready label to actionable", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Ready task",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
        ],
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.status).toBe("actionable")
  })

  test("extracts dependsOn and blocks from deps/dependents", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Task",
        status: "open",
        dependencies: [
          { id: "dep-1", dependency_type: "blocks" },
          { id: "dep-2", dependency_type: "parent-child" },
        ],
        dependents: [
          { id: "dep-3", dependency_type: "blocks" },
        ],
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.dependsOn).toEqual(["dep-1"])
    expect(tasks[0]!.blocks).toEqual(["dep-3"])
  })

  test("infers parentId from dotted ID", () => {
    const json = JSON.stringify([
      { id: "epic-1.sub-1", title: "Child task", status: "open" },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.parentId).toBe("epic-1")
  })

  test("uses explicit parent over inferred", () => {
    const json = JSON.stringify([
      {
        id: "epic-1.sub-1",
        title: "Child task",
        status: "open",
        parent: "explicit-parent",
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.parentId).toBe("explicit-parent")
  })

  test("handles empty array", () => {
    expect(parseBdTaskList("[]")).toEqual([])
  })

  test("handles single object (not array)", () => {
    const json = JSON.stringify({
      id: "single",
      title: "Single task",
      status: "open",
    })

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe("single")
  })

  test("returns empty array for invalid JSON", () => {
    expect(parseBdTaskList("not json")).toEqual([])
    expect(parseBdTaskList("")).toEqual([])
    expect(parseBdTaskList("{")).toEqual([])
  })

  test("filters out items without id", () => {
    const json = JSON.stringify([
      { title: "No ID" },
      { id: "has-id", title: "Has ID", status: "open" },
      { id: 123, title: "Numeric ID" },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe("has-id")
  })

  test("preserves all content fields", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Full task",
        description: "A description",
        design: "A design",
        acceptance_criteria: "- [ ] Criterion 1\n- [x] Criterion 2",
        notes: "Some notes",
        status: "open",
        issue_type: "feature",
        close_reason: "All done",
      },
    ])

    const tasks = parseBdTaskList(json)
    const t = tasks[0]!
    expect(t.description).toBe("A description")
    expect(t.design).toBe("A design")
    expect(t.acceptance_criteria).toBe("- [ ] Criterion 1\n- [x] Criterion 2")
    expect(t.notes).toBe("Some notes")
    expect(t.issueType).toBe("feature")
    expect(t.closeReason).toBe("All done")
  })

  test("handles unknown status gracefully", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Mystery", status: "mystery_status" },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks[0]!.status).toBe("backlog") // fallback
  })

  // -------------------------------------------------------------------------
  // Status derivation — PRD alignment (prd/ralphe-status-alignment.md)
  // -------------------------------------------------------------------------

  test("open + no ready + no error + no blockers → backlog", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Backlog item", status: "open" },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("backlog")
  })

  test("open + ready + no error + no blockers → actionable", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Ready item", status: "open", labels: ["ready"] },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("actionable")
  })

  test("open + ready + other labels + no error + no blockers → actionable", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Ready item", status: "open", labels: ["frontend", "ready", "p1"] },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("actionable")
  })

  test("open + unresolved blocking deps → blocked (regardless of ready label)", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Blocked",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("blocked")
  })

  test("open + error label → error (regardless of ready label or blockers)", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Errored",
        status: "open",
        labels: ["ready", "error"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("error")
  })

  test("open + error label without ready → error", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Errored", status: "open", labels: ["error"] },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("error")
  })

  test("in_progress → active", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Active", status: "in_progress" },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("active")
  })

  test("closed → done", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Done", status: "closed" },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("done")
  })

  test("open errored dependency keeps dependent blocked", () => {
    // The dependency itself is open+error; the dependent should be blocked
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Dependent task",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    // dep-1 is open (not closed/cancelled) so t-1 is blocked
    expect(parseBdTaskList(json)[0]!.status).toBe("blocked")
  })

  test("cancelled deps do not block", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Unblocked",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "cancelled", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("actionable")
  })

  test("in_progress deps still block", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Blocked by WIP",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "in_progress", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("blocked")
  })
})

// ---------------------------------------------------------------------------
// getAvailableActions
// ---------------------------------------------------------------------------

describe("getAvailableActions", () => {
  const makeTask = (status: WatchTask["status"], owner?: string): WatchTask => ({
    id: "t-1",
    title: "Test task",
    status,
    owner,
  })

  test("backlog tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("backlog"))
    expect(actions).toEqual([])
  })

  test("actionable tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("actionable"))
    expect(actions).toEqual([])
  })

  test("blocked tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("blocked"))
    expect(actions).toEqual([])
  })

  test("active tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("active"))
    expect(actions).toEqual([])
  })

  test("active tasks with owner still have no manual actions", () => {
    const actions = getAvailableActions(makeTask("active", "worker-1"))
    expect(actions).toEqual([])
  })

  test("done tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("done"))
    expect(actions).toEqual([])
  })

  test("error tasks have no manual actions", () => {
    const actions = getAvailableActions(makeTask("error"))
    expect(actions).toEqual([])
  })

  test("no actions available for unknown status", () => {
    // Force a status that doesn't match any case
    const task = { ...makeTask("actionable"), status: "unknown" as WatchTask["status"] }
    const actions = getAvailableActions(task)
    expect(actions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// beadsDatabaseExists
// ---------------------------------------------------------------------------

describe("beadsDatabaseExists", () => {
  test("returns false for nonexistent directory", () => {
    expect(beadsDatabaseExists("/tmp/nonexistent-ralphe-test-dir")).toBe(false)
  })

  // Note: Testing the "true" case requires the actual .beads dir to exist
  // in the repo root, which it does in this project.
  test("returns true for project root", () => {
    // The project root has a .beads directory
    const projectRoot = process.cwd().includes("apps/ralphe")
      ? process.cwd().replace(/\/apps\/ralphe.*/, "")
      : process.cwd()

    // Only assert if we can locate the project root .beads dir
    const fs = require("node:fs")
    const path = require("node:path")
    if (fs.existsSync(path.join(projectRoot, ".beads"))) {
      expect(beadsDatabaseExists(projectRoot)).toBe(true)
    }
  })
})
