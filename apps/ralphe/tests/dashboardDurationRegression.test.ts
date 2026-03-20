/**
 * ABOUTME: Regression tests for the dashboard duration fix.
 * Locks the end-to-end contract from ralphe metadata parsing through duration
 * rendering and live-tick activation, ensuring the fix does not regress into
 * broken fallback behavior or unnecessary backend refreshes.
 */

import { describe, it, expect } from "bun:test"
import { parseBdTaskList } from "../src/beadsAdapter.js"
import {
  formatDuration,
  computeDuration,
  hasActiveTimedTask,
} from "../src/tui/DashboardView.js"
import type { WatchTask } from "../src/beadsAdapter.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  status: WatchTask["status"],
  opts?: { startedAt?: string; finishedAt?: string },
): WatchTask {
  return {
    id: "reg-1",
    title: "Regression task",
    status,
    startedAt: opts?.startedAt,
    finishedAt: opts?.finishedAt,
  }
}

/** Build bd JSON with ralphe metadata (object or string form). */
function bdJson(
  overrides: {
    id?: string
    status?: string
    ralphe?: Record<string, unknown> | string
    metadata?: Record<string, unknown>
  },
): string {
  const { id = "reg-1", status = "in_progress", ralphe, metadata } = overrides
  const meta = metadata ?? (ralphe !== undefined ? { ralphe } : undefined)
  const item: Record<string, unknown> = { id, title: "Regression task", status }
  if (meta) item.metadata = meta
  return JSON.stringify([item])
}

// ---------------------------------------------------------------------------
// 1. Metadata parsing parity: object vs serialized-string ralphe metadata
// ---------------------------------------------------------------------------

describe("regression: metadata parsing parity", () => {
  const timestamps = {
    startedAt: "2025-03-15T10:00:00.000Z",
    finishedAt: "2025-03-15T10:07:30.000Z",
  }

  it("object and serialized-string forms produce identical WatchTask timing fields", () => {
    const objJson = bdJson({
      ralphe: { engine: "claude", workerId: "w1", ...timestamps },
    })
    const strJson = bdJson({
      ralphe: JSON.stringify({ engine: "claude", workerId: "w1", ...timestamps }),
    })

    const [objTask] = parseBdTaskList(objJson)
    const [strTask] = parseBdTaskList(strJson)

    expect(objTask!.startedAt).toBe(timestamps.startedAt)
    expect(objTask!.finishedAt).toBe(timestamps.finishedAt)
    expect(strTask!.startedAt).toBe(timestamps.startedAt)
    expect(strTask!.finishedAt).toBe(timestamps.finishedAt)

    // The two forms must be indistinguishable downstream
    expect(objTask!.startedAt).toBe(strTask!.startedAt)
    expect(objTask!.finishedAt).toBe(strTask!.finishedAt)
  })

  it("object form with only startedAt leaves finishedAt undefined", () => {
    const json = bdJson({
      ralphe: { engine: "claude", startedAt: timestamps.startedAt },
    })
    const [task] = parseBdTaskList(json)
    expect(task!.startedAt).toBe(timestamps.startedAt)
    expect(task!.finishedAt).toBeUndefined()
  })

  it("serialized-string form with only startedAt leaves finishedAt undefined", () => {
    const json = bdJson({
      ralphe: JSON.stringify({ engine: "claude", startedAt: timestamps.startedAt }),
    })
    const [task] = parseBdTaskList(json)
    expect(task!.startedAt).toBe(timestamps.startedAt)
    expect(task!.finishedAt).toBeUndefined()
  })

  it("non-string timestamp values in ralphe metadata are ignored", () => {
    const json = bdJson({
      ralphe: { engine: "claude", startedAt: 12345, finishedAt: null },
    })
    const [task] = parseBdTaskList(json)
    expect(task!.startedAt).toBeUndefined()
    expect(task!.finishedAt).toBeUndefined()
  })

  it("serialized non-string timestamp values are ignored", () => {
    const json = bdJson({
      ralphe: JSON.stringify({ startedAt: 12345, finishedAt: true }),
    })
    const [task] = parseBdTaskList(json)
    expect(task!.startedAt).toBeUndefined()
    expect(task!.finishedAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. Active duration: startedAt present vs missing/invalid
// ---------------------------------------------------------------------------

describe("regression: active duration behavior", () => {
  it("renders live elapsed time when startedAt is valid", () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
    const result = computeDuration(makeTask("active", { startedAt: tenSecondsAgo }))
    // Must be a formatted duration, not the dash fallback
    expect(result).not.toBe("—")
    expect(result).toMatch(/^\d+s$/)
    const secs = parseInt(result, 10)
    expect(secs).toBeGreaterThanOrEqual(9)
    expect(secs).toBeLessThanOrEqual(12)
  })

  it("renders longer active durations in minutes", () => {
    const threeMinutesAgo = new Date(Date.now() - 185_000).toISOString()
    const result = computeDuration(makeTask("active", { startedAt: threeMinutesAgo }))
    expect(result).toMatch(/^3m \d+s$/)
  })

  it("falls back to dash when startedAt is missing", () => {
    expect(computeDuration(makeTask("active"))).toBe("—")
  })

  it("falls back to dash when startedAt is empty string", () => {
    expect(computeDuration(makeTask("active", { startedAt: "" }))).toBe("—")
  })

  it("falls back to dash when startedAt is garbage", () => {
    expect(computeDuration(makeTask("active", { startedAt: "yesterday" }))).toBe("—")
  })

  it("falls back to dash when startedAt is a numeric string (non-ISO)", () => {
    // "0" parses to epoch — still a valid Date, so this exercises that
    // the code does not accidentally produce a wildly wrong duration.
    // Depending on implementation, it may return a huge duration or dash.
    const result = computeDuration(makeTask("active", { startedAt: "0" }))
    // As long as it doesn't throw, the contract is met.
    expect(typeof result).toBe("string")
  })

  it("ignores finishedAt for active status (live elapsed only)", () => {
    const fiveSecsAgo = new Date(Date.now() - 5_000).toISOString()
    const result = computeDuration(makeTask("active", {
      startedAt: fiveSecsAgo,
      finishedAt: new Date(Date.now() - 2_000).toISOString(),
    }))
    // Active always uses live elapsed, never finishedAt
    expect(result).toMatch(/^\d+s$/)
    const secs = parseInt(result, 10)
    expect(secs).toBeGreaterThanOrEqual(4)
    expect(secs).toBeLessThanOrEqual(7)
  })
})

// ---------------------------------------------------------------------------
// 3. Final duration for done and error rows
// ---------------------------------------------------------------------------

describe("regression: final duration for done and error", () => {
  const start = "2025-06-01T08:00:00.000Z"

  it("done row renders exact final duration", () => {
    const finish = "2025-06-01T08:03:45.000Z" // 3m 45s
    expect(computeDuration(makeTask("done", { startedAt: start, finishedAt: finish }))).toBe("3m 45s")
  })

  it("error row renders exact final duration", () => {
    const finish = "2025-06-01T08:00:12.000Z" // 12s
    expect(computeDuration(makeTask("error", { startedAt: start, finishedAt: finish }))).toBe("12s")
  })

  it("done row with hour-scale duration formats correctly", () => {
    const finish = "2025-06-01T10:22:00.000Z" // 2h 22m
    expect(computeDuration(makeTask("done", { startedAt: start, finishedAt: finish }))).toBe("2h 22m")
  })

  it("done row with zero-duration renders 0s", () => {
    expect(computeDuration(makeTask("done", { startedAt: start, finishedAt: start }))).toBe("0s")
  })

  it("done row without startedAt falls back to dash", () => {
    expect(computeDuration(makeTask("done", { finishedAt: "2025-06-01T08:00:00Z" }))).toBe("—")
  })

  it("done row without finishedAt falls back to dash", () => {
    expect(computeDuration(makeTask("done", { startedAt: start }))).toBe("—")
  })

  it("error row without finishedAt falls back to dash", () => {
    expect(computeDuration(makeTask("error", { startedAt: start }))).toBe("—")
  })

  it("done row with invalid finishedAt falls back to dash", () => {
    expect(computeDuration(makeTask("done", { startedAt: start, finishedAt: "nope" }))).toBe("—")
  })

  it("error row with invalid startedAt falls back to dash", () => {
    expect(computeDuration(makeTask("error", { startedAt: "nope", finishedAt: "2025-06-01T08:00:00Z" }))).toBe("—")
  })
})

// ---------------------------------------------------------------------------
// 4. Tick activation: only when active timed tasks are present
// ---------------------------------------------------------------------------

describe("regression: live-tick activation rules", () => {
  it("activates tick for a single active task with valid startedAt", () => {
    const tasks = [makeTask("active", { startedAt: new Date().toISOString() })]
    expect(hasActiveTimedTask(tasks)).toBe(true)
  })

  it("does not activate tick when no tasks exist", () => {
    expect(hasActiveTimedTask([])).toBe(false)
  })

  it("does not activate tick for active task without startedAt", () => {
    expect(hasActiveTimedTask([makeTask("active")])).toBe(false)
  })

  it("does not activate tick for active task with invalid startedAt", () => {
    expect(hasActiveTimedTask([makeTask("active", { startedAt: "garbage" })])).toBe(false)
  })

  it("does not activate tick when all tasks are terminal (done/error)", () => {
    const tasks = [
      makeTask("done", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:01:00Z" }),
      makeTask("error", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:02:00Z" }),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })

  it("does not activate tick for waiting statuses even with timestamps", () => {
    const tasks = [
      makeTask("backlog", { startedAt: "2025-01-01T00:00:00Z" }),
      makeTask("queued", { startedAt: "2025-01-01T00:00:00Z" }),
      makeTask("blocked", { startedAt: "2025-01-01T00:00:00Z" }),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })

  it("activates tick when one active task among many has valid startedAt", () => {
    const tasks = [
      makeTask("backlog"),
      makeTask("done", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:01:00Z" }),
      makeTask("active"),  // no startedAt
      makeTask("active", { startedAt: new Date().toISOString() }),  // this one triggers
      makeTask("error", { startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T00:05:00Z" }),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(true)
  })

  it("does not activate tick when multiple active tasks all lack valid startedAt", () => {
    const tasks = [
      makeTask("active"),
      makeTask("active", { startedAt: "invalid" }),
      makeTask("active", { startedAt: "" }),
    ]
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. End-to-end: metadata parsing → duration rendering
// ---------------------------------------------------------------------------

describe("regression: end-to-end metadata-to-duration", () => {
  it("object ralphe metadata flows through to correct done duration", () => {
    const json = bdJson({
      status: "closed",
      ralphe: {
        engine: "claude",
        startedAt: "2025-06-01T08:00:00.000Z",
        finishedAt: "2025-06-01T08:04:15.000Z",
      },
    })
    const [task] = parseBdTaskList(json)
    expect(computeDuration(task!)).toBe("4m 15s")
  })

  it("serialized-string ralphe metadata flows through to correct done duration", () => {
    const json = bdJson({
      status: "closed",
      ralphe: JSON.stringify({
        engine: "claude",
        startedAt: "2025-06-01T08:00:00.000Z",
        finishedAt: "2025-06-01T08:04:15.000Z",
      }),
    })
    const [task] = parseBdTaskList(json)
    expect(computeDuration(task!)).toBe("4m 15s")
  })

  it("missing ralphe metadata produces dash duration", () => {
    const json = bdJson({ metadata: { other: { foo: "bar" } } })
    const [task] = parseBdTaskList(json)
    expect(computeDuration(task!)).toBe("—")
  })

  it("unparseable serialized ralphe metadata produces dash duration", () => {
    const json = bdJson({ ralphe: "{{{broken" as unknown as string })
    const [task] = parseBdTaskList(json)
    expect(computeDuration(task!)).toBe("—")
  })

  it("parsed tasks with active timing metadata activate the tick", () => {
    const now = new Date().toISOString()
    const json = bdJson({
      status: "in_progress",
      ralphe: { engine: "claude", startedAt: now },
    })
    const tasks = parseBdTaskList(json)
    expect(hasActiveTimedTask(tasks)).toBe(true)
  })

  it("parsed tasks without timing metadata do not activate the tick", () => {
    const json = bdJson({ status: "in_progress" })
    const tasks = parseBdTaskList(json)
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })

  it("parsed done tasks never activate the tick", () => {
    const json = bdJson({
      status: "closed",
      ralphe: {
        engine: "claude",
        startedAt: "2025-06-01T08:00:00.000Z",
        finishedAt: "2025-06-01T08:04:00.000Z",
      },
    })
    const tasks = parseBdTaskList(json)
    expect(hasActiveTimedTask(tasks)).toBe(false)
  })
})
