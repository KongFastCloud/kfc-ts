/**
 * ABOUTME: Tests for the dashboard partitioning logic.
 * Verifies that tasks are correctly split into non-done and done buckets,
 * preserving original ordering within each bucket.
 */

import { describe, it, expect } from "bun:test"
import { partitionTasks, formatCompletedAt, formatIdCell } from "../src/tui/DashboardView.js"
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

describe("formatIdCell", () => {
  it("pads a short ID to the column width", () => {
    const result = formatIdCell("ABC-1")
    // Should be exactly 12 characters (COL.id width)
    expect(result).toHaveLength(12)
    expect(result).toBe("ABC-1       ")
  })

  it("truncates a long ID with ellipsis", () => {
    const longId = "VERY-LONG-ID-12345"
    const result = formatIdCell(longId)
    expect(result).toHaveLength(12)
    // Should end with ellipsis due to truncation
    expect(result).toMatch(/…\s*$|…$/)
  })

  it("handles an ID exactly at column width", () => {
    const exactId = "ABCDEFGHIJKL" // 12 chars = COL.id
    const result = formatIdCell(exactId)
    expect(result).toHaveLength(12)
    // Truncated to COL.id - 1 = 11 chars (10 + ellipsis), then padded to 12
    expect(result).toContain("…")
  })

  it("handles an empty ID", () => {
    const result = formatIdCell("")
    expect(result).toHaveLength(12)
    expect(result.trim()).toBe("")
  })

  it("handles an ID one char shorter than column width", () => {
    const id = "ABCDEFGHIJK" // 11 chars = COL.id - 1
    const result = formatIdCell(id)
    expect(result).toHaveLength(12)
    expect(result.startsWith("ABCDEFGHIJK")).toBe(true)
  })
})

describe("formatCompletedAt", () => {
  it("formats a valid ISO timestamp into compact local datetime", () => {
    // Use a fixed date and check parts are present
    const result = formatCompletedAt("2026-03-19T19:41:00Z")
    // Should contain month, day, time, and AM/PM
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M$/)
  })

  it("returns — for undefined input", () => {
    expect(formatCompletedAt(undefined)).toBe("—")
  })

  it("returns — for empty string", () => {
    expect(formatCompletedAt("")).toBe("—")
  })

  it("returns — for invalid date string", () => {
    expect(formatCompletedAt("not-a-date")).toBe("—")
  })

  it("formats midnight correctly with 12-hour clock", () => {
    // Create a date at midnight local time
    const midnight = new Date(2026, 0, 15, 0, 5) // Jan 15, 2026 00:05 local
    const result = formatCompletedAt(midnight.toISOString())
    expect(result).toContain("12:05 AM")
  })

  it("formats noon correctly with 12-hour clock", () => {
    const noon = new Date(2026, 5, 10, 12, 30) // Jun 10, 2026 12:30 local
    const result = formatCompletedAt(noon.toISOString())
    expect(result).toContain("12:30 PM")
  })
})
