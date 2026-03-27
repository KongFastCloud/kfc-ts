/**
 * ABOUTME: Tests for the dashboard partitioning logic, row-count derivation,
 * pane width budgeting, and epic status rendering contracts.
 * Verifies that tasks are correctly split into non-done and done buckets,
 * preserving original ordering within each bucket, that measured box
 * heights are correctly converted to visible row counts, that pane
 * title widths are conservatively derived so content never clips on the
 * right edge, and that queued_for_deletion renders with the approved
 * deleting label, warning color, and loading indicator.
 */

import { describe, it, expect } from "bun:test"
import { partitionTasks, sortDoneTasks, formatCompletedAt, formatIdCell, TABLE_CHROME_LINES, deriveVisibleRowCount, computePaneWidths, epicStatusColor, epicStatusIndicator, epicStatusLabel } from "../src/tui/DashboardView.js"
import type { WatchTask } from "../src/beadsAdapter.js"
import type { EpicDisplayStatus } from "../src/tui/epicStatus.js"

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
      makeTask("2", "queued"),
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
      makeTask("z", "queued"),
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
      "backlog", "queued", "blocked", "active", "error", "done",
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

// ---------------------------------------------------------------------------
// sortDoneTasks
// ---------------------------------------------------------------------------

function makeDoneTask(id: string, closedAt?: string): WatchTask {
  return { id, title: `Task ${id}`, status: "done", closedAt }
}

describe("sortDoneTasks", () => {
  it("sorts done tasks by closedAt descending (newest first)", () => {
    const tasks = [
      makeDoneTask("old", "2026-01-01T00:00:00Z"),
      makeDoneTask("mid", "2026-02-15T00:00:00Z"),
      makeDoneTask("new", "2026-03-19T00:00:00Z"),
    ]
    const sorted = sortDoneTasks(tasks)
    expect(sorted.map((t) => t.id)).toEqual(["new", "mid", "old"])
  })

  it("places tasks with missing closedAt after valid ones", () => {
    const tasks = [
      makeDoneTask("no-date", undefined),
      makeDoneTask("has-date", "2026-03-19T12:00:00Z"),
    ]
    const sorted = sortDoneTasks(tasks)
    expect(sorted.map((t) => t.id)).toEqual(["has-date", "no-date"])
  })

  it("places tasks with invalid closedAt after valid ones", () => {
    const tasks = [
      makeDoneTask("invalid", "not-a-date"),
      makeDoneTask("valid", "2026-03-19T12:00:00Z"),
    ]
    const sorted = sortDoneTasks(tasks)
    expect(sorted.map((t) => t.id)).toEqual(["valid", "invalid"])
  })

  it("preserves original order among tasks with equally missing/invalid closedAt", () => {
    const tasks = [
      makeDoneTask("a", undefined),
      makeDoneTask("b", "not-valid"),
      makeDoneTask("c", undefined),
    ]
    const sorted = sortDoneTasks(tasks)
    // All invalid — stable original order preserved
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"])
  })

  it("handles empty input", () => {
    expect(sortDoneTasks([])).toEqual([])
  })

  it("handles single task", () => {
    const tasks = [makeDoneTask("only", "2026-03-19T00:00:00Z")]
    const sorted = sortDoneTasks(tasks)
    expect(sorted.map((t) => t.id)).toEqual(["only"])
  })

  it("sorts mixed valid and invalid closedAt correctly", () => {
    const tasks = [
      makeDoneTask("no-date-1", undefined),
      makeDoneTask("old", "2026-01-01T00:00:00Z"),
      makeDoneTask("no-date-2", undefined),
      makeDoneTask("new", "2026-03-19T00:00:00Z"),
      makeDoneTask("invalid", "garbage"),
    ]
    const sorted = sortDoneTasks(tasks)
    expect(sorted.map((t) => t.id)).toEqual([
      "new",         // newest valid
      "old",         // oldest valid
      "no-date-1",   // invalid, original index 0
      "no-date-2",   // invalid, original index 2
      "invalid",     // invalid, original index 4
    ])
  })

  it("handles tasks with identical closedAt timestamps", () => {
    const tasks = [
      makeDoneTask("first", "2026-03-19T12:00:00Z"),
      makeDoneTask("second", "2026-03-19T12:00:00Z"),
      makeDoneTask("third", "2026-03-19T12:00:00Z"),
    ]
    const sorted = sortDoneTasks(tasks)
    // Same timestamp — stable original order preserved
    expect(sorted.map((t) => t.id)).toEqual(["first", "second", "third"])
  })
})

// ---------------------------------------------------------------------------
// Non-done table order preservation (regression guard)
// ---------------------------------------------------------------------------

describe("partitionTasks preserves non-done order (regression)", () => {
  it("active bucket keeps adapter ordering regardless of done sorting", () => {
    const tasks = [
      makeTask("z", "queued"),
      { ...makeTask("d1", "done"), closedAt: "2026-03-19T00:00:00Z" },
      makeTask("a", "active"),
      { ...makeTask("d2", "done"), closedAt: "2026-01-01T00:00:00Z" },
      makeTask("m", "blocked"),
    ]
    const { active } = partitionTasks(tasks)
    // Active order must match input order — not affected by done sorting
    expect(active.map((t) => t.id)).toEqual(["z", "a", "m"])
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

// ---------------------------------------------------------------------------
// deriveVisibleRowCount — height-to-row-count derivation
// ---------------------------------------------------------------------------

describe("deriveVisibleRowCount", () => {
  it("subtracts TABLE_CHROME_LINES from measured height", () => {
    // Normal case: 20 lines measured → 20 - 4 = 16 data rows
    expect(deriveVisibleRowCount(20)).toBe(20 - TABLE_CHROME_LINES)
  })

  it("returns 0 when measured height is 0", () => {
    expect(deriveVisibleRowCount(0)).toBe(0)
  })

  it("returns 0 when measured height equals TABLE_CHROME_LINES", () => {
    // Exactly enough for chrome, no room for data rows
    expect(deriveVisibleRowCount(TABLE_CHROME_LINES)).toBe(0)
  })

  it("returns 0 when measured height is less than TABLE_CHROME_LINES", () => {
    expect(deriveVisibleRowCount(1)).toBe(0)
    expect(deriveVisibleRowCount(2)).toBe(0)
    expect(deriveVisibleRowCount(3)).toBe(0)
  })

  it("returns 1 when measured height is one more than TABLE_CHROME_LINES", () => {
    expect(deriveVisibleRowCount(TABLE_CHROME_LINES + 1)).toBe(1)
  })

  it("handles large heights correctly", () => {
    expect(deriveVisibleRowCount(100)).toBe(96)
    expect(deriveVisibleRowCount(500)).toBe(496)
  })

  it("clamps negative measured heights to 0", () => {
    // Defensive: negative heights should not produce negative row counts
    expect(deriveVisibleRowCount(-1)).toBe(0)
    expect(deriveVisibleRowCount(-10)).toBe(0)
  })
})

describe("TABLE_CHROME_LINES", () => {
  it("accounts for border-top, border-bottom, section title, and column header", () => {
    // border top (1) + border bottom (1) + section title (1) + column header (1) = 4
    expect(TABLE_CHROME_LINES).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// computePaneWidths — right-edge safety regression tests
// ---------------------------------------------------------------------------

describe("computePaneWidths", () => {
  it("produces non-negative title widths at a standard 80-column terminal", () => {
    const w = computePaneWidths(80)
    expect(w.activeTitleWidth).toBeGreaterThanOrEqual(0)
    expect(w.doneTitleWidth).toBeGreaterThanOrEqual(0)
    expect(w.epicTitleWidth).toBeGreaterThanOrEqual(0)
  })

  it("produces non-negative title widths at a narrow 40-column terminal", () => {
    const w = computePaneWidths(40)
    expect(w.activeTitleWidth).toBeGreaterThanOrEqual(0)
    expect(w.doneTitleWidth).toBeGreaterThanOrEqual(0)
    expect(w.epicTitleWidth).toBeGreaterThanOrEqual(0)
  })

  it("produces non-negative title widths at an extremely narrow terminal", () => {
    const w = computePaneWidths(20)
    expect(w.activeTitleWidth).toBe(0)
    expect(w.doneTitleWidth).toBe(0)
    expect(w.epicTitleWidth).toBe(0)
  })

  it("splits bottom panes using conservative floor for both epic and done", () => {
    const w = computePaneWidths(120)
    // Both use Math.floor so neither overestimates its actual flex allocation.
    expect(w.epicPaneWidth).toBe(Math.floor(120 / 2))
    expect(w.donePaneWidth).toBe(Math.floor(120 / 2))
  })

  it("bottom pane widths sum to at most the terminal width", () => {
    for (const tw of [60, 80, 100, 120, 150, 200, 300]) {
      const w = computePaneWidths(tw)
      // donePaneWidth + epicPaneWidth should never exceed terminalWidth
      expect(w.donePaneWidth + w.epicPaneWidth).toBeLessThanOrEqual(tw)
    }
  })

  it("active row content fits within terminal width", () => {
    // Active pane content: id(12) + sep(3) + title + status(12) + ready(14) + priority(5) + duration(10) + padding(2) + border(2)
    const fixedActive = 12 + 3 + 12 + 14 + 5 + 10 + 2 + 2
    for (const tw of [80, 120, 200, 300]) {
      const w = computePaneWidths(tw)
      const totalRowWidth = fixedActive + w.activeTitleWidth
      expect(totalRowWidth).toBeLessThanOrEqual(tw)
    }
  })

  it("done row content fits within its pane width at all practical widths", () => {
    // Done pane content: id(12) + sep(3) + title + status(12) + completed(dynamic) + duration(10) + chrome(4)
    const fixedDone = 12 + 3 + 12 + 10 + 4
    for (const tw of [82, 100, 120, 150, 200, 300]) {
      const w = computePaneWidths(tw)
      const totalRowWidth = fixedDone + w.doneTitleWidth + w.doneCompletedWidth
      expect(totalRowWidth).toBeLessThanOrEqual(w.donePaneWidth)
    }
  })

  it("epic row content fits within its pane width at all practical widths", () => {
    // Epic pane content: id(12) + sep(3) + title + epicStatus(dynamic) + chrome(4)
    const fixedEpic = 12 + 3 + 4
    for (const tw of [38, 80, 100, 120, 150, 200, 300]) {
      const w = computePaneWidths(tw)
      const totalRowWidth = fixedEpic + w.epicTitleWidth + w.epicStatusWidth
      expect(totalRowWidth).toBeLessThanOrEqual(w.epicPaneWidth)
    }
  })

  it("title widths grow as terminal width increases", () => {
    const w80 = computePaneWidths(80)
    const w200 = computePaneWidths(200)
    expect(w200.activeTitleWidth).toBeGreaterThan(w80.activeTitleWidth)
    expect(w200.doneTitleWidth).toBeGreaterThan(w80.doneTitleWidth)
    expect(w200.epicTitleWidth).toBeGreaterThan(w80.epicTitleWidth)
  })

  it("epic status column reaches full width at wide terminals", () => {
    const w = computePaneWidths(300)
    expect(w.epicStatusWidth).toBe(22) // COL.epicStatus
  })

  it("done completed column reaches full width at wide terminals", () => {
    const w = computePaneWidths(300)
    expect(w.doneCompletedWidth).toBe(22) // COL.completedDone
  })

  it("dynamic columns shrink gracefully at narrow terminals", () => {
    const w = computePaneWidths(80)
    // At 80 cols, panes are narrow — dynamic columns should shrink
    expect(w.epicStatusWidth).toBeLessThan(22)
    expect(w.epicStatusWidth).toBeGreaterThanOrEqual(0)
    expect(w.doneCompletedWidth).toBeLessThanOrEqual(22)
    expect(w.doneCompletedWidth).toBeGreaterThanOrEqual(0)
  })

  it("all column widths remain non-negative at any terminal width", () => {
    for (const tw of [20, 40, 60, 80, 100, 120, 200]) {
      const w = computePaneWidths(tw)
      expect(w.activeTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.doneTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.epicTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.epicStatusWidth).toBeGreaterThanOrEqual(0)
      expect(w.doneCompletedWidth).toBeGreaterThanOrEqual(0)
    }
  })

  it("both bottom pane estimates are individually ≤ their ideal flex share", () => {
    // Regardless of how the flex engine rounds, our floor-based estimates
    // must never exceed the share that a 1:1 split could yield.
    for (const tw of [60, 79, 80, 81, 100, 119, 120, 121, 200, 301]) {
      const w = computePaneWidths(tw)
      // Neither pane should exceed ceil(tw/2) — the most the engine could give it.
      expect(w.epicPaneWidth).toBeLessThanOrEqual(Math.ceil(tw / 2))
      expect(w.donePaneWidth).toBeLessThanOrEqual(Math.ceil(tw / 2))
    }
  })

  it("bottom pane estimates never sum above terminal width (right-edge invariant)", () => {
    // Sweep every width from 20 to 300 to catch any rounding edge case.
    for (let tw = 20; tw <= 300; tw++) {
      const w = computePaneWidths(tw)
      expect(w.donePaneWidth + w.epicPaneWidth).toBeLessThanOrEqual(tw)
    }
  })

  it("active row content fits terminal width with explicit margin at odd widths", () => {
    // Active pane content: id(12) + sep(3) + title + status(12) + ready(14) + priority(5) + duration(10) + chrome(4)
    const fixedActive = 12 + 3 + 12 + 14 + 5 + 10 + 4
    for (const tw of [61, 79, 81, 99, 101, 121, 199]) {
      const w = computePaneWidths(tw)
      const totalRowWidth = fixedActive + w.activeTitleWidth
      expect(totalRowWidth).toBeLessThanOrEqual(tw)
    }
  })

  it("done row content fits pane budget at moderate-to-narrow terminals", () => {
    // Below ~82 columns the done pane allocation (floor(tw/2)) is smaller than
    // fixed done columns (37) + chrome (4) = 41, an inherent limitation at very
    // narrow widths. Verify from 82 upward.
    const fixedDone = 12 + 3 + 12 + 10 + 4 // id + sep + status + duration + chrome
    for (const tw of [82, 100, 120, 150]) {
      const w = computePaneWidths(tw)
      const total = fixedDone + w.doneTitleWidth + w.doneCompletedWidth
      expect(total).toBeLessThanOrEqual(w.donePaneWidth)
    }
  })

  it("epic row content fits pane budget at moderate-to-narrow terminals", () => {
    // Below ~40 columns the epic pane's fixed columns (15) + chrome (4) = 19
    // plus safety margin exceed the pane allocation (floor(tw/2)).
    // Verify the invariant holds from 40 upward.
    const fixedEpic = 12 + 3 + 4 // id + sep + chrome
    for (const tw of [40, 50, 60, 80]) {
      const w = computePaneWidths(tw)
      const total = fixedEpic + w.epicTitleWidth + w.epicStatusWidth
      expect(total).toBeLessThanOrEqual(w.epicPaneWidth)
    }
  })

  it("both bottom panes use equal 50:50 budget (contract guard)", () => {
    // Explicitly lock in the 1:1 bottom-row split so future changes
    // cannot silently reintroduce a weighted (e.g. 1:2) split.
    for (const tw of [60, 80, 100, 120, 200]) {
      const w = computePaneWidths(tw)
      expect(w.epicPaneWidth).toBe(w.donePaneWidth)
    }
  })
})

// ---------------------------------------------------------------------------
// Epic status rendering contract — queued_for_deletion presentation
// ---------------------------------------------------------------------------

describe("epic status rendering contract", () => {
  /** The warning color from the dashboard theme (orange). */
  const WARNING_COLOR = "#e0af68"

  it("queued_for_deletion uses warning/orange color", () => {
    expect(epicStatusColor.queued_for_deletion).toBe(WARNING_COLOR)
  })

  it("queued_for_deletion uses the loading indicator ◌", () => {
    expect(epicStatusIndicator.queued_for_deletion).toBe("◌")
  })

  it("queued_for_deletion displays as 'deleting' label", () => {
    expect(epicStatusLabel.queued_for_deletion).toBe("deleting")
  })

  it("queued_for_deletion color matches dirty (both use warning)", () => {
    // Both in-progress states share the same orange/warning color
    expect(epicStatusColor.queued_for_deletion).toBe(epicStatusColor.dirty)
  })

  it("queued_for_deletion indicator differs from error indicator", () => {
    // Deletion-in-progress must not look like a hard failure
    expect(epicStatusIndicator.queued_for_deletion).not.toBe(epicStatusIndicator.error)
  })

  it("queued_for_deletion color differs from error color", () => {
    expect(epicStatusColor.queued_for_deletion).not.toBe(epicStatusColor.error)
  })

  it("all epic statuses have a defined color, indicator, and label", () => {
    const allStatuses: EpicDisplayStatus[] = [
      "error", "not_started", "active", "dirty", "queued_for_deletion",
    ]
    for (const s of allStatuses) {
      expect(epicStatusColor[s]).toBeDefined()
      expect(epicStatusColor[s].length).toBeGreaterThan(0)
      expect(epicStatusIndicator[s]).toBeDefined()
      expect(epicStatusIndicator[s].length).toBeGreaterThan(0)
      expect(epicStatusLabel[s]).toBeDefined()
      expect(epicStatusLabel[s].length).toBeGreaterThan(0)
    }
  })

  it("non-deletion statuses use their status name as the display label", () => {
    // Only queued_for_deletion has a remapped label; all others pass through.
    expect(epicStatusLabel.error).toBe("error")
    expect(epicStatusLabel.not_started).toBe("not_started")
    expect(epicStatusLabel.active).toBe("active")
    expect(epicStatusLabel.dirty).toBe("dirty")
  })
})
