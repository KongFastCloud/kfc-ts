/**
 * ABOUTME: Tests for the watch TUI header and footer width-safety helpers.
 * Verifies that header content (error, config, right section) and footer
 * shortcut text never exceed the available terminal width, even under
 * narrow terminals or long dynamic content.
 */

import { describe, it, expect } from "bun:test"
import {
  computeHeaderRightWidth,
  computeHeaderErrorBudget,
  buildFooterText,
} from "../src/tui/WatchApp.js"

// ---------------------------------------------------------------------------
// computeHeaderRightWidth
// ---------------------------------------------------------------------------

describe("computeHeaderRightWidth", () => {
  it("returns a positive width for a typical running worker", () => {
    const { rightWidth } = computeHeaderRightWidth(
      { state: "running", currentTaskId: "abc-123" },
      5,
      "12:34:56",
    )
    expect(rightWidth).toBeGreaterThan(0)
  })

  it("returns a positive width for an idle worker with no task", () => {
    const { rightWidth } = computeHeaderRightWidth(
      { state: "idle" },
      10,
      "09:00:00",
    )
    expect(rightWidth).toBeGreaterThan(0)
  })

  it("returns a positive width when no worker status is present", () => {
    const { rightWidth } = computeHeaderRightWidth(undefined, 3, "08:00:00")
    expect(rightWidth).toBeGreaterThan(0)
  })

  it("truncates long task IDs to at most 16 characters", () => {
    const longId = "very-long-task-identifier-that-exceeds-limit"
    const { taskIdDisplay } = computeHeaderRightWidth(
      { state: "running", currentTaskId: longId },
      1,
      "00:00:00",
    )
    expect(taskIdDisplay).toBeDefined()
    expect(taskIdDisplay!.length).toBeLessThanOrEqual(16)
  })

  it("keeps short task IDs intact", () => {
    const { taskIdDisplay } = computeHeaderRightWidth(
      { state: "running", currentTaskId: "abc" },
      1,
      "00:00:00",
    )
    expect(taskIdDisplay).toBe("abc")
  })

  it("returns undefined taskIdDisplay when worker has no current task", () => {
    const { taskIdDisplay } = computeHeaderRightWidth(
      { state: "idle", currentTaskId: undefined },
      1,
      "00:00:00",
    )
    expect(taskIdDisplay).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// computeHeaderErrorBudget
// ---------------------------------------------------------------------------

describe("computeHeaderErrorBudget", () => {
  it("returns a positive budget at standard terminal widths", () => {
    // 80 col terminal, moderate right section, no config
    const budget = computeHeaderErrorBudget(78, 30, 0, false)
    expect(budget).toBeGreaterThan(0)
  })

  it("returns 0 when no room is available", () => {
    // Very narrow: content width barely fits right section
    const budget = computeHeaderErrorBudget(30, 28, 0, false)
    expect(budget).toBe(0)
  })

  it("reduces budget when config is shown", () => {
    const withoutConfig = computeHeaderErrorBudget(78, 25, 20, false)
    const withConfig = computeHeaderErrorBudget(78, 25, 20, true)
    expect(withConfig).toBeLessThan(withoutConfig)
  })

  it("never returns a negative value", () => {
    for (const cw of [0, 5, 10, 15, 20]) {
      const budget = computeHeaderErrorBudget(cw, 30, 20, true)
      expect(budget).toBeGreaterThanOrEqual(0)
    }
  })

  it("total header content stays within content width at practical widths", () => {
    // When budget > 0 the error is rendered: leftFixed(14) + errorPrefix(3) + budget + rightWidth
    // When budget === 0 the error is hidden entirely — we only check that
    // the error + prefix does not push past the available space.
    // Use a realistic rightWidth (32) which requires at least ~50 cols to fit
    // alongside the left section.
    const rightWidth = 32 // typical: worker status + task count + time
    const configWidth = 30
    for (const tw of [80, 100, 120, 200]) {
      const contentWidth = tw - 2
      const budget = computeHeaderErrorBudget(contentWidth, rightWidth, configWidth, false)
      if (budget > 0) {
        const totalUsed = 14 + 3 + budget + rightWidth
        expect(totalUsed).toBeLessThanOrEqual(contentWidth)
      }
    }
  })

  it("returns 0 budget when terminal is too narrow for error + right section", () => {
    // At 40 cols, contentWidth=38, rightWidth=32 → no room for error
    const budget = computeHeaderErrorBudget(38, 32, 0, false)
    expect(budget).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildFooterText
// ---------------------------------------------------------------------------

describe("buildFooterText", () => {
  it("returns truncated text that fits within terminal width minus chrome", () => {
    for (const tw of [40, 60, 80, 100, 120]) {
      const text = buildFooterText("dashboard", tw, true, true)
      // Content area = tw - 2 (padding) - 2 (safety margin)
      expect(text.length).toBeLessThanOrEqual(Math.max(0, tw - 4))
    }
  })

  it("includes all shortcuts when terminal is wide enough", () => {
    const text = buildFooterText("dashboard", 200, true, true)
    expect(text).toContain("Navigate")
    expect(text).toContain("Switch Pane")
    expect(text).toContain("Detail")
    expect(text).toContain("Mark Ready")
    expect(text).toContain("Delete Epic")
    expect(text).toContain("Quit")
  })

  it("omits Mark Ready when hasMarkReady is false", () => {
    const text = buildFooterText("dashboard", 200, false, true)
    expect(text).not.toContain("Mark Ready")
  })

  it("omits Delete Epic when hasEpicDelete is false", () => {
    const text = buildFooterText("dashboard", 200, true, false)
    expect(text).not.toContain("Delete Epic")
  })

  it("returns detail shortcuts in detail mode", () => {
    const text = buildFooterText("detail", 200)
    expect(text).toContain("Esc/Backspace:Back")
    expect(text).toContain("Quit")
    expect(text).not.toContain("Navigate")
  })

  it("truncates gracefully at very narrow widths", () => {
    const text = buildFooterText("dashboard", 20, true, true)
    // Should not exceed the safe width
    expect(text.length).toBeLessThanOrEqual(Math.max(0, 20 - 4))
  })

  it("returns empty string when terminal width is 0", () => {
    const text = buildFooterText("dashboard", 0)
    expect(text).toBe("")
  })

  it("never exceeds terminal width for any practical width (≥ 5)", () => {
    // Below ~5 columns the padding alone (2) + safety margin (2) exceeds
    // the terminal width, which is an inherent limitation at unusable widths.
    for (let tw = 5; tw <= 200; tw++) {
      const text = buildFooterText("dashboard", tw, true, true)
      // Text length + padding(2) should never exceed terminal width
      expect(text.length + 2).toBeLessThanOrEqual(tw)
    }
  })
})
