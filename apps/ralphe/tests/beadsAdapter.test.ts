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

  test("maps flat bd list dependencies to blocked using related issue status lookup", () => {
    const json = JSON.stringify([
      { id: "dep-1", title: "Open blocker", status: "open" },
      {
        id: "t-1",
        title: "Blocked task",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { issue_id: "t-1", depends_on_id: "dep-1", type: "blocks" },
        ],
      },
    ])

    const tasks = parseBdTaskList(json)
    const task = tasks.find((item) => item.id === "t-1")
    expect(task?.status).toBe("blocked")
    expect(task?.dependsOn).toEqual(["dep-1"])
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

  test("maps open with resolved blocking deps and ready label to queued", () => {
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
    expect(tasks[0]!.status).toBe("queued")
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

  test("open + ready + no error + no blockers → queued", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Ready item", status: "open", labels: ["ready"] },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
  })

  test("open + ready + other labels + no error + no blockers → queued", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Ready item", status: "open", labels: ["frontend", "ready", "p1"] },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
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

  test("open + error + ready + unresolved blockers → blocked (blockers override ready)", () => {
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
    expect(parseBdTaskList(json)[0]!.status).toBe("blocked")
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
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
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

  // -------------------------------------------------------------------------
  // Dependency blocking regression — PRD §Dependency Behavior
  // -------------------------------------------------------------------------

  test("mixed deps: one closed, one open → still blocked", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Mixed deps",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
          { id: "dep-2", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("blocked")
  })

  test("parent-child dependencies do not cause blocking", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Child task",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "parent-1", status: "open", dependency_type: "parent-child" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
  })

  test("closed dependency unblocks regardless of its labels", () => {
    // A dependency that was closed (even if it had error labels before closing)
    // should count as resolved and not block the dependent.
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Unblocked",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
  })

  test("all deps closed → queued when ready label present", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Fully unblocked",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
          { id: "dep-2", status: "closed", dependency_type: "blocks" },
          { id: "dep-3", status: "cancelled", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("queued")
  })

  test("all deps closed but no ready label → backlog, not queued", () => {
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Resolved but not ready",
        status: "open",
        dependencies: [
          { id: "dep-1", status: "closed", dependency_type: "blocks" },
        ],
      },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("backlog")
  })

  test("cancelled task maps to error (not done)", () => {
    // cancelled is a terminal failure — distinct from closed-success
    const json = JSON.stringify([
      { id: "t-1", title: "Cancelled", status: "cancelled" },
    ])
    expect(parseBdTaskList(json)[0]!.status).toBe("error")
  })

  // -------------------------------------------------------------------------
  // Label precedence regression — PRD §Label Behavior
  // -------------------------------------------------------------------------

  test("error + ready label on open task with no deps → queued (ready overrides error for retry)", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Errored+Ready", status: "open", labels: ["ready", "error"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("queued")
  })

  test("error label on open task with blockers → blocked (blockers override error)", () => {
    // Blockers take highest priority among open-task derivations
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Errored+Blocked",
        status: "open",
        labels: ["error"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
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
  const makeTask = (status: WatchTask["status"], overrides?: Partial<WatchTask>): WatchTask => ({
    id: "t-1",
    title: "Test task",
    status,
    ...overrides,
  })

  test("backlog tasks expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("backlog"))
    expect(actions).toContain("mark-ready")
  })

  test("queued tasks do not expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("queued"))
    expect(actions).not.toContain("mark-ready")
    expect(actions).toEqual([])
  })

  test("blocked tasks expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("blocked"))
    expect(actions).toContain("mark-ready")
  })

  test("active tasks do not expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("active"))
    expect(actions).not.toContain("mark-ready")
    expect(actions).toEqual([])
  })

  test("active tasks with owner do not expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("active", { owner: "worker-1" }))
    expect(actions).not.toContain("mark-ready")
    expect(actions).toEqual([])
  })

  test("error tasks expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("error"))
    expect(actions).toContain("mark-ready")
  })

  test("done tasks do not expose mark-ready action", () => {
    const actions = getAvailableActions(makeTask("done"))
    expect(actions).not.toContain("mark-ready")
    expect(actions).toEqual([])
  })

  test("no actions available for unknown status", () => {
    // Force a status that doesn't match any case
    const task = { ...makeTask("queued"), status: "unknown" as WatchTask["status"] }
    const actions = getAvailableActions(task)
    expect(actions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Mark Ready — status derivation after relabeling
// ---------------------------------------------------------------------------

describe("mark-ready status outcomes", () => {
  test("error issue marked ready derives to queued — error label preserved (no blockers)", () => {
    // After mark-ready: labels change from [error] to [error, ready]
    // Error label is preserved so the agent can see previous failure context.
    const json = JSON.stringify([
      { id: "t-1", title: "Was error", status: "open", labels: ["error", "ready"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("queued")
  })

  test("blocked issue relabeled to ready still derives to blocked", () => {
    // After mark-ready: labels change to [ready], but blocker still open
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Still blocked",
        status: "open",
        labels: ["ready"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("blocked")
  })

  test("in_progress issue relabeled to ready still derives to active", () => {
    // After mark-ready: labels change to [ready], but in_progress takes precedence
    const json = JSON.stringify([
      { id: "t-1", title: "Still active", status: "in_progress", labels: ["ready"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("active")
  })

  test("backlog issue relabeled to ready derives to queued (no blockers)", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Now ready", status: "open", labels: ["ready"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("queued")
  })

  test("already-ready issue remains stable after mark-ready", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Already ready", status: "open", labels: ["ready"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("queued")
  })

  test("error issue marked ready but blocked stays blocked", () => {
    // After mark-ready: labels are [error, ready], but blocker still open
    const json = JSON.stringify([
      {
        id: "t-1",
        title: "Error retry blocked",
        status: "open",
        labels: ["error", "ready"],
        dependencies: [
          { id: "dep-1", status: "open", dependency_type: "blocks" },
        ],
      },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("blocked")
  })

  test("re-failed task (ready removed, error kept) derives to error", () => {
    // After markTaskExhaustedFailure: labels are [error] (ready was removed)
    const json = JSON.stringify([
      { id: "t-1", title: "Failed again", status: "open", labels: ["error"] },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("error")
  })

  test("successfully completed retry task (closed, error cleared) derives to done", () => {
    // After closeTaskSuccess: task is closed and error label removed
    const json = JSON.stringify([
      { id: "t-1", title: "Fixed on retry", status: "closed" },
    ])
    const task = parseBdTaskList(json)[0]!
    expect(task.status).toBe("done")
  })
})

// ---------------------------------------------------------------------------
// Actionable filtering — only queued tasks are eligible for automatic pickup
// ---------------------------------------------------------------------------

describe("queued filtering (queryActionable semantics)", () => {
  // These tests verify the filtering behavior that queryActionable applies:
  // only tasks with derived status "queued" pass through.

  test("only queued tasks survive filtering from a mixed list", () => {
    const json = JSON.stringify([
      { id: "backlog-1", title: "Backlog", status: "open" },
      { id: "ready-1", title: "Ready", status: "open", labels: ["ready"] },
      { id: "blocked-1", title: "Blocked", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "open", dependency_type: "blocks" }] },
      { id: "error-1", title: "Errored", status: "open", labels: ["error"] },
      { id: "active-1", title: "Active", status: "in_progress" },
      { id: "done-1", title: "Done", status: "closed" },
    ])

    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")

    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe("ready-1")
  })

  test("backlog issues are excluded from automatic pickup", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "No ready label", status: "open" },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(0)
  })

  test("blocked issues are excluded from automatic pickup even with ready label", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Blocked", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "open", dependency_type: "blocks" }] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(0)
  })

  test("error issues are excluded from automatic pickup", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Errored", status: "open", labels: ["error"] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(0)
  })

  test("error issues with ready label are included as queued (retry)", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Error+Ready", status: "open", labels: ["ready", "error"] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe("t-1")
  })

  test("open errored dependency keeps dependent out of queued set", () => {
    const json = JSON.stringify([
      // dep-1 is open+error: an unresolved dependency
      { id: "dep-1", title: "Failed dep", status: "open", labels: ["error"] },
      // t-1 depends on dep-1 (which is open, not closed), so t-1 is blocked
      { id: "t-1", title: "Waiting", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "open", dependency_type: "blocks" }] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(0)
  })

  test("only genuinely resolved (closed) dependencies unblock into queued", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Unblocked", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "closed", dependency_type: "blocks" }] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe("t-1")
  })

  test("cancelled deps resolve but cancelled tasks themselves are errors", () => {
    // dep-1 is cancelled (resolved dependency), t-1 should be queued.
    // But t-2 itself is cancelled → error status, not queued.
    const json = JSON.stringify([
      { id: "t-1", title: "Depends on cancelled", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "cancelled", dependency_type: "blocks" }] },
      { id: "t-2", title: "Cancelled task", status: "cancelled" },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe("t-1")
    expect(tasks.find((t) => t.id === "t-2")!.status).toBe("error")
  })

  test("active and done statuses are excluded from queued", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Active", status: "in_progress" },
      { id: "t-2", title: "Done", status: "closed" },
      { id: "t-3", title: "Actionable", status: "open", labels: ["ready"] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe("t-3")
  })

  test("dependency with in_progress status keeps dependent out of queued", () => {
    const json = JSON.stringify([
      { id: "t-1", title: "Waiting on WIP", status: "open", labels: ["ready"],
        dependencies: [{ id: "dep-1", status: "in_progress", dependency_type: "blocks" }] },
    ])
    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued).toHaveLength(0)
  })

  test("flat bd list dependencies with open blocker are excluded from queued", () => {
    const json = JSON.stringify([
      { id: "dep-1", title: "Navigation slice", status: "open", labels: ["ready"] },
      {
        id: "t-1",
        title: "Focus rules",
        status: "open",
        labels: ["ready"],
        dependencies: [{ issue_id: "t-1", depends_on_id: "dep-1", type: "blocks" }],
      },
    ])

    const tasks = parseBdTaskList(json)
    const queued = tasks.filter((t) => t.status === "queued")
    expect(queued.map((t) => t.id)).toEqual(["dep-1"])
    expect(tasks.find((t) => t.id === "t-1")?.status).toBe("blocked")
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
