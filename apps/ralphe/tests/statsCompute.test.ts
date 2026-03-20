import { describe, it, expect } from "bun:test"
import { computeDayTotal, computeWeekTotal } from "../src/tui/statsCompute.js"
import type { WatchTask } from "../src/beadsAdapter.js"

// ---------- helpers ----------

/** Wednesday 2026-03-18 at noon local time */
const REF = new Date(2026, 2, 18, 12, 0, 0) // month is 0-indexed

function makeTask(
  overrides: Partial<WatchTask> & { id: string },
): WatchTask {
  return {
    title: `Task ${overrides.id}`,
    status: "done" as const,
    ...overrides,
  }
}

/** Shorthand: create a done task that ran for `durationMs` finishing at `finishedAt`. */
function doneTask(
  id: string,
  finishedAt: Date,
  durationMs: number,
): WatchTask {
  const startedAt = new Date(finishedAt.getTime() - durationMs)
  return makeTask({
    id,
    status: "done",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  })
}

// ---------- computeDayTotal ----------

describe("computeDayTotal", () => {
  it("returns correct total for tasks finishing today", () => {
    const tasks = [
      doneTask("a", new Date(2026, 2, 18, 9, 0), 60_000),
      doneTask("b", new Date(2026, 2, 18, 14, 30), 120_000),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 180_000, count: 2 })
  })

  it("excludes tasks finishing yesterday", () => {
    const tasks = [
      doneTask("yesterday", new Date(2026, 2, 17, 23, 59), 10_000),
      doneTask("today", new Date(2026, 2, 18, 0, 5), 5_000),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 5_000, count: 1 })
  })

  it("excludes tasks finishing tomorrow", () => {
    const tasks = [
      doneTask("tomorrow", new Date(2026, 2, 19, 0, 0), 10_000),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("includes task finishing exactly at midnight (start of day)", () => {
    const tasks = [
      doneTask("midnight", new Date(2026, 2, 18, 0, 0, 0, 0), 1_000),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 1_000, count: 1 })
  })

  it("excludes task finishing exactly at next midnight (end of day)", () => {
    const tasks = [
      doneTask("next-midnight", new Date(2026, 2, 19, 0, 0, 0, 0), 1_000),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("includes task finishing at 23:59:59.999", () => {
    const tasks = [
      doneTask("eod", new Date(2026, 2, 18, 23, 59, 59, 999), 500),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 500, count: 1 })
  })

  it("excludes non-done tasks", () => {
    const tasks = [
      makeTask({
        id: "active-task",
        status: "active",
        startedAt: new Date(2026, 2, 18, 8, 0).toISOString(),
        finishedAt: new Date(2026, 2, 18, 9, 0).toISOString(),
      }),
      makeTask({
        id: "queued-task",
        status: "queued",
        startedAt: new Date(2026, 2, 18, 8, 0).toISOString(),
        finishedAt: new Date(2026, 2, 18, 9, 0).toISOString(),
      }),
      makeTask({
        id: "error-task",
        status: "error",
        startedAt: new Date(2026, 2, 18, 8, 0).toISOString(),
        finishedAt: new Date(2026, 2, 18, 9, 0).toISOString(),
      }),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks with missing startedAt", () => {
    const tasks = [
      makeTask({
        id: "no-start",
        status: "done",
        finishedAt: new Date(2026, 2, 18, 10, 0).toISOString(),
      }),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks with missing finishedAt", () => {
    const tasks = [
      makeTask({
        id: "no-finish",
        status: "done",
        startedAt: new Date(2026, 2, 18, 10, 0).toISOString(),
      }),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks with invalid/unparseable date strings", () => {
    const tasks = [
      makeTask({
        id: "bad-start",
        status: "done",
        startedAt: "not-a-date",
        finishedAt: new Date(2026, 2, 18, 10, 0).toISOString(),
      }),
      makeTask({
        id: "bad-finish",
        status: "done",
        startedAt: new Date(2026, 2, 18, 9, 0).toISOString(),
        finishedAt: "garbage",
      }),
      makeTask({
        id: "empty-strings",
        status: "done",
        startedAt: "",
        finishedAt: "",
      }),
    ]
    const result = computeDayTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("returns { totalMs: 0, count: 0 } for empty task list", () => {
    expect(computeDayTotal([], REF)).toEqual({ totalMs: 0, count: 0 })
  })
})

// ---------- computeWeekTotal ----------

describe("computeWeekTotal", () => {
  // REF = Wed 2026-03-18, so week is Mon 2026-03-16 to Sun 2026-03-22

  it("returns correct total for tasks finishing this week", () => {
    const tasks = [
      doneTask("mon", new Date(2026, 2, 16, 10, 0), 30_000),
      doneTask("wed", new Date(2026, 2, 18, 15, 0), 60_000),
      doneTask("sun", new Date(2026, 2, 22, 20, 0), 90_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 180_000, count: 3 })
  })

  it("excludes tasks finishing last week (Sunday before)", () => {
    const tasks = [
      doneTask("last-sun", new Date(2026, 2, 15, 23, 59), 10_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks finishing next week (Monday after)", () => {
    const tasks = [
      doneTask("next-mon", new Date(2026, 2, 23, 0, 0), 10_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("includes task finishing exactly at Monday midnight (start of week)", () => {
    const tasks = [
      doneTask("mon-midnight", new Date(2026, 2, 16, 0, 0, 0, 0), 2_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 2_000, count: 1 })
  })

  it("includes task finishing Sunday 23:59:59.999", () => {
    const tasks = [
      doneTask("sun-eod", new Date(2026, 2, 22, 23, 59, 59, 999), 3_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 3_000, count: 1 })
  })

  it("excludes next Monday 00:00:00.000 (end of week window)", () => {
    const tasks = [
      doneTask("next-mon-exact", new Date(2026, 2, 23, 0, 0, 0, 0), 1_000),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes non-done tasks", () => {
    const tasks = [
      makeTask({
        id: "active",
        status: "active",
        startedAt: new Date(2026, 2, 18, 8, 0).toISOString(),
        finishedAt: new Date(2026, 2, 18, 9, 0).toISOString(),
      }),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks with missing timestamps", () => {
    const tasks = [
      makeTask({ id: "no-times", status: "done" }),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("excludes tasks with invalid date strings", () => {
    const tasks = [
      makeTask({
        id: "bad",
        status: "done",
        startedAt: "xyz",
        finishedAt: "abc",
      }),
    ]
    const result = computeWeekTotal(tasks, REF)
    expect(result).toEqual({ totalMs: 0, count: 0 })
  })

  it("returns { totalMs: 0, count: 0 } for empty task list", () => {
    expect(computeWeekTotal([], REF)).toEqual({ totalMs: 0, count: 0 })
  })

  it("handles referenceDate on a Monday", () => {
    const monday = new Date(2026, 2, 16, 8, 0) // Mon 2026-03-16
    const tasks = [
      doneTask("mon-task", new Date(2026, 2, 16, 12, 0), 5_000),
      // Previous Sunday should be excluded (different week)
      doneTask("prev-sun", new Date(2026, 2, 15, 20, 0), 5_000),
    ]
    const result = computeWeekTotal(tasks, monday)
    expect(result).toEqual({ totalMs: 5_000, count: 1 })
  })

  it("handles referenceDate on a Sunday", () => {
    const sunday = new Date(2026, 2, 22, 18, 0) // Sun 2026-03-22
    const tasks = [
      doneTask("sun-task", new Date(2026, 2, 22, 12, 0), 7_000),
      doneTask("mon-task", new Date(2026, 2, 16, 9, 0), 3_000),
      // Next Monday should be excluded
      doneTask("next-mon", new Date(2026, 2, 23, 1, 0), 1_000),
    ]
    const result = computeWeekTotal(tasks, sunday)
    expect(result).toEqual({ totalMs: 10_000, count: 2 })
  })
})
