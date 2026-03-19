/**
 * ABOUTME: Tests for dashboard duration formatting and computation.
 * Verifies that formatDuration produces human-readable strings and
 * computeDuration derives correct values from task status and timing metadata.
 */

import { describe, it, expect } from "bun:test"
import { formatDuration, computeDuration, hasActiveTimedTask } from "../src/tui/DashboardView.js"
import type { WatchTask } from "../src/beadsAdapter.js"

function makeTask(
  status: WatchTask["status"],
  opts?: { startedAt?: string; finishedAt?: string },
): WatchTask {
  return {
    id: "test-1",
    title: "Test task",
    status,
    startedAt: opts?.startedAt,
    finishedAt: opts?.finishedAt,
  }
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(1_000)).toBe("1s")
    expect(formatDuration(59_000)).toBe("59s")
  })

  it("formats minutes and seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s")
    expect(formatDuration(90_000)).toBe("1m 30s")
    expect(formatDuration(3_599_000)).toBe("59m 59s")
  })

  it("formats hours and minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(5_400_000)).toBe("1h 30m")
    expect(formatDuration(7_260_000)).toBe("2h 1m")
  })

  it("returns dash for negative values", () => {
    expect(formatDuration(-1)).toBe("—")
    expect(formatDuration(-1_000)).toBe("—")
  })
})

// ---------------------------------------------------------------------------
// computeDuration
// ---------------------------------------------------------------------------

describe("computeDuration", () => {
  it("returns dash for backlog status", () => {
    expect(computeDuration(makeTask("backlog"))).toBe("—")
    expect(computeDuration(makeTask("backlog", {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }))).toBe("—")
  })

  it("returns dash for actionable status", () => {
    expect(computeDuration(makeTask("actionable"))).toBe("—")
  })

  it("returns dash for blocked status", () => {
    expect(computeDuration(makeTask("blocked"))).toBe("—")
  })

  it("returns dash for active with no startedAt", () => {
    expect(computeDuration(makeTask("active"))).toBe("—")
  })

  it("returns live elapsed time for active with startedAt", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString()
    const result = computeDuration(makeTask("active", { startedAt: fiveSecondsAgo }))
    // Should be approximately "5s" (allow for test execution time)
    expect(result).toMatch(/^\d+s$/)
    const seconds = parseInt(result, 10)
    expect(seconds).toBeGreaterThanOrEqual(4)
    expect(seconds).toBeLessThanOrEqual(7)
  })

  it("returns final duration for done with both timestamps", () => {
    const start = "2025-01-01T00:00:00.000Z"
    const finish = "2025-01-01T00:02:30.000Z" // 2m 30s later
    const result = computeDuration(makeTask("done", { startedAt: start, finishedAt: finish }))
    expect(result).toBe("2m 30s")
  })

  it("returns final duration for error with both timestamps", () => {
    const start = "2025-01-01T00:00:00.000Z"
    const finish = "2025-01-01T01:15:00.000Z" // 1h 15m later
    const result = computeDuration(makeTask("error", { startedAt: start, finishedAt: finish }))
    expect(result).toBe("1h 15m")
  })

  it("returns dash for done without startedAt", () => {
    expect(computeDuration(makeTask("done"))).toBe("—")
  })

  it("returns dash for done with startedAt but no finishedAt", () => {
    expect(computeDuration(makeTask("done", {
      startedAt: "2025-01-01T00:00:00.000Z",
    }))).toBe("—")
  })

  it("returns dash for error without finishedAt", () => {
    expect(computeDuration(makeTask("error", {
      startedAt: "2025-01-01T00:00:00.000Z",
    }))).toBe("—")
  })

  it("returns dash for invalid startedAt", () => {
    expect(computeDuration(makeTask("active", { startedAt: "not-a-date" }))).toBe("—")
  })

  it("returns dash for invalid finishedAt", () => {
    expect(computeDuration(makeTask("done", {
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "not-a-date",
    }))).toBe("—")
  })
})

// ---------------------------------------------------------------------------
// hasActiveTimedTask (tick activation rules)
// ---------------------------------------------------------------------------

describe("hasActiveTimedTask", () => {
  it("returns true when an active task has valid startedAt", () => {
    const tasks = [makeTask("active", { startedAt: new Date().toISOString() })]
    expect(hasActiveTimedTask(tasks)).toBe(true)
  })

  it("returns false when no tasks are present", () => {
    expect(hasActiveTimedTask([])).toBe(false)
  })

  it("returns false when active task has no startedAt", () => {
    expect(hasActiveTimedTask([makeTask("active")])).toBe(false)
  })

  it("returns false when active task has invalid startedAt", () => {
    expect(hasActiveTimedTask([makeTask("active", { startedAt: "not-a-date" })])).toBe(false)
  })

  it("returns false when only non-active statuses have startedAt", () => {
    const tasks = [
      makeTask("done", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:01:00Z" }),
      makeTask("error", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:01:00Z" }),
      makeTask("backlog"),
      makeTask("actionable"),
      makeTask("blocked"),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })

  it("returns true when at least one active task among many has valid startedAt", () => {
    const tasks = [
      makeTask("backlog"),
      makeTask("done", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:01:00Z" }),
      makeTask("active", { startedAt: new Date().toISOString() }),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(true)
  })
})
