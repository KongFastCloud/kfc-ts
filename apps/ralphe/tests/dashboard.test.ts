/**
 * ABOUTME: Tests for the dashboard partitioning logic.
 * Verifies that tasks are correctly split into non-done and done buckets,
 * preserving original ordering within each bucket.
 */

import { describe, it, expect } from "bun:test"
import { partitionTasks } from "../src/tui/DashboardView.js"
import type { WatchTask } from "../src/beadsAdapter.js"

function makeTask(id: string, status: WatchTask["status"]): WatchTask {
  return { id, title: `Task ${id}`, status }
}

describe("partitionTasks", () => {
  it("puts done tasks only in the done bucket", () => {
    const tasks = [
      makeTask("1", "done"),
      makeTask("2", "done"),
    ]
    const { active, done } = partitionTasks(tasks)
    expect(active).toHaveLength(0)
    expect(done).toHaveLength(2)
    expect(done.map((t) => t.id)).toEqual(["1", "2"])
  })

  it("puts non-done tasks only in the active bucket", () => {
    const tasks = [
      makeTask("1", "backlog"),
      makeTask("2", "actionable"),
      makeTask("3", "blocked"),
      makeTask("4", "active"),
      makeTask("5", "error"),
    ]
    const { active, done } = partitionTasks(tasks)
    expect(active).toHaveLength(5)
    expect(done).toHaveLength(0)
    expect(active.map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"])
  })

  it("splits mixed tasks correctly", () => {
    const tasks = [
      makeTask("1", "active"),
      makeTask("2", "done"),
      makeTask("3", "backlog"),
      makeTask("4", "done"),
      makeTask("5", "blocked"),
    ]
    const { active, done } = partitionTasks(tasks)
    expect(active.map((t) => t.id)).toEqual(["1", "3", "5"])
    expect(done.map((t) => t.id)).toEqual(["2", "4"])
  })

  it("preserves adapter ordering within each bucket", () => {
    const tasks = [
      makeTask("z", "actionable"),
      makeTask("a", "done"),
      makeTask("m", "error"),
      makeTask("b", "done"),
      makeTask("c", "backlog"),
    ]
    const { active, done } = partitionTasks(tasks)
    // Order should match input order, not sorted
    expect(active.map((t) => t.id)).toEqual(["z", "m", "c"])
    expect(done.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("returns empty buckets for empty input", () => {
    const { active, done } = partitionTasks([])
    expect(active).toHaveLength(0)
    expect(done).toHaveLength(0)
  })

  it("never places done tasks in the active bucket", () => {
    // Exhaustive: ensure done status is exclusively in done bucket
    const allStatuses: WatchTask["status"][] = [
      "backlog", "actionable", "blocked", "active", "error", "done",
    ]
    const tasks = allStatuses.map((s, i) => makeTask(String(i), s))
    const { active, done } = partitionTasks(tasks)

    for (const t of active) {
      expect(t.status).not.toBe("done")
    }
    for (const t of done) {
      expect(t.status).toBe("done")
    }
  })
})
