import { describe, test, expect } from "bun:test"
import {
  parseBdTaskList,
  beadsDatabaseExists,
  getAvailableActions,
  taskActionKey,
  taskActionLabel,
  keyToTaskAction,
  type WatchTask,
  type TaskAction,
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
    expect(tasks[0]!.status).toBe("actionable")
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

  test("maps open with resolved blocking deps to actionable", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Ready task",
        status: "open",
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
    expect(tasks[0]!.status).toBe("actionable") // fallback
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

  test("actionable tasks can be started, completed, or cancelled", () => {
    const actions = getAvailableActions(makeTask("actionable"))
    expect(actions).toEqual(["start", "complete", "cancel"])
  })

  test("blocked tasks can only be cancelled", () => {
    const actions = getAvailableActions(makeTask("blocked"))
    expect(actions).toEqual(["cancel"])
  })

  test("active tasks can be completed or failed", () => {
    const actions = getAvailableActions(makeTask("active"))
    expect(actions).toEqual(["complete", "fail"])
  })

  test("active tasks with owner still allow complete/fail", () => {
    const actions = getAvailableActions(makeTask("active", "worker-1"))
    expect(actions).toEqual(["complete", "fail"])
  })

  test("done tasks can be reopened", () => {
    const actions = getAvailableActions(makeTask("done"))
    expect(actions).toEqual(["reopen"])
  })

  test("error tasks can be reopened", () => {
    const actions = getAvailableActions(makeTask("error"))
    expect(actions).toEqual(["reopen"])
  })

  test("no actions available for unknown status", () => {
    // Force a status that doesn't match any case
    const task = { ...makeTask("actionable"), status: "unknown" as WatchTask["status"] }
    const actions = getAvailableActions(task)
    expect(actions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Task action key/label mappings
// ---------------------------------------------------------------------------

describe("taskActionKey and taskActionLabel", () => {
  test("every action has a key and label", () => {
    const allActions: TaskAction[] = ["start", "complete", "fail", "cancel", "reopen"]
    for (const action of allActions) {
      expect(taskActionKey[action]).toBeDefined()
      expect(taskActionLabel[action]).toBeDefined()
      expect(typeof taskActionKey[action]).toBe("string")
      expect(typeof taskActionLabel[action]).toBe("string")
    }
  })

  test("keyToTaskAction reverses taskActionKey", () => {
    const allActions: TaskAction[] = ["start", "complete", "fail", "cancel", "reopen"]
    for (const action of allActions) {
      const key = taskActionKey[action]
      expect(keyToTaskAction[key]).toBe(action)
    }
  })

  test("keys are single characters", () => {
    for (const key of Object.keys(keyToTaskAction)) {
      expect(key).toHaveLength(1)
    }
  })

  test("no key conflicts with navigation keys", () => {
    const navKeys = ["q", "r", "k", "j"]
    for (const key of Object.keys(keyToTaskAction)) {
      expect(navKeys).not.toContain(key)
    }
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
