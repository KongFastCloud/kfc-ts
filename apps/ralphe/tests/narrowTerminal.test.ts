/**
 * ABOUTME: Narrow-terminal regression tests for watch TUI layout.
 * Locks in right-edge safety invariants across pane widths, header/footer
 * chrome, and column budgets at narrow terminal widths (20–80 columns).
 * These tests would fail if a future change reintroduces right-edge
 * clipping through width-budget drift.
 */

import { describe, it, expect } from "bun:test"
import { computePaneWidths } from "../src/tui/DashboardView.js"
import {
  computeHeaderRightWidth,
  computeHeaderErrorBudget,
  buildFooterText,
} from "../src/tui/WatchApp.js"

// ---------------------------------------------------------------------------
// Constants mirrored from source for invariant assertions
// ---------------------------------------------------------------------------

/** Pane chrome: left/right border (2) + left/right row padding (2). */
const PANE_CHROME = 4

/** Fixed columns in an active row (excluding title). */
const ACTIVE_FIXED = 12 + 3 + 12 + 14 + 5 + 10 + PANE_CHROME // 64

/** Fixed columns in a done row (excluding title and completed). */
const DONE_FIXED = 12 + 3 + 12 + 10 + PANE_CHROME // 45 — id + sep + status + duration + chrome

/** Fixed columns in an epic row (excluding title and status). */
const EPIC_FIXED = 12 + 3 + PANE_CHROME // 19 — id + sep + chrome

// ---------------------------------------------------------------------------
// Pane width regression: comprehensive narrow sweep
// ---------------------------------------------------------------------------

describe("narrow-terminal pane width regression", () => {
  it("all column widths are non-negative across narrow sweep (20–80)", () => {
    for (let tw = 20; tw <= 80; tw++) {
      const w = computePaneWidths(tw)
      expect(w.activeTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.doneTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.epicTitleWidth).toBeGreaterThanOrEqual(0)
      expect(w.epicStatusWidth).toBeGreaterThanOrEqual(0)
      expect(w.doneCompletedWidth).toBeGreaterThanOrEqual(0)
    }
  })

  it("bottom pane widths never exceed terminal width across narrow sweep (20–80)", () => {
    for (let tw = 20; tw <= 80; tw++) {
      const w = computePaneWidths(tw)
      expect(w.epicPaneWidth + w.donePaneWidth).toBeLessThanOrEqual(tw)
    }
  })

  it("active row content never exceeds terminal width (sweep 60–120)", () => {
    // Below 60 columns the fixed columns alone (60) exceed the terminal
    // width — an inherent limitation at unusable widths for the active pane.
    for (let tw = 60; tw <= 120; tw++) {
      const w = computePaneWidths(tw)
      const totalRow = ACTIVE_FIXED + w.activeTitleWidth
      expect(totalRow).toBeLessThanOrEqual(tw)
    }
  })

  it("active title collapses to 0 at narrow widths without underflow", () => {
    for (let tw = 20; tw <= 66; tw++) {
      const w = computePaneWidths(tw)
      expect(w.activeTitleWidth).toBe(0)
    }
  })

  it("done row content never exceeds its pane width (sweep 62–120)", () => {
    // Below 62 columns the done pane allocation (floor(2tw/3)) is smaller
    // than the fixed done columns (41), so the invariant cannot hold.
    // At 62+, the done pane has enough room for at least the fixed columns.
    for (let tw = 62; tw <= 120; tw++) {
      const w = computePaneWidths(tw)
      const totalRow = DONE_FIXED + w.doneTitleWidth + w.doneCompletedWidth
      expect(totalRow).toBeLessThanOrEqual(w.donePaneWidth)
    }
  })

  it("epic row content never exceeds its pane width (sweep 57–120)", () => {
    // Below 57 columns the epic pane allocation (floor(tw/3)) is smaller
    // than the fixed epic columns (19), so the invariant cannot hold.
    for (let tw = 57; tw <= 120; tw++) {
      const w = computePaneWidths(tw)
      const totalRow = EPIC_FIXED + w.epicTitleWidth + w.epicStatusWidth
      expect(totalRow).toBeLessThanOrEqual(w.epicPaneWidth)
    }
  })

  it("title widths are monotonically non-decreasing as width grows (20–200)", () => {
    let prevActive = 0
    let prevDone = 0
    let prevEpic = 0
    for (let tw = 20; tw <= 200; tw++) {
      const w = computePaneWidths(tw)
      expect(w.activeTitleWidth).toBeGreaterThanOrEqual(prevActive)
      expect(w.doneTitleWidth).toBeGreaterThanOrEqual(prevDone)
      expect(w.epicTitleWidth).toBeGreaterThanOrEqual(prevEpic)
      prevActive = w.activeTitleWidth
      prevDone = w.doneTitleWidth
      prevEpic = w.epicTitleWidth
    }
  })

  it("dynamic columns (epicStatus, doneCompleted) never exceed their max", () => {
    for (let tw = 20; tw <= 200; tw++) {
      const w = computePaneWidths(tw)
      expect(w.epicStatusWidth).toBeLessThanOrEqual(22) // COL.epicStatus
      expect(w.doneCompletedWidth).toBeLessThanOrEqual(22) // COL.completedDone
    }
  })

  it("extremely narrow terminals (1–19) produce all-zero title widths without crashing", () => {
    for (let tw = 1; tw <= 19; tw++) {
      const w = computePaneWidths(tw)
      expect(w.activeTitleWidth).toBe(0)
      expect(w.doneTitleWidth).toBe(0)
      expect(w.epicTitleWidth).toBe(0)
      expect(w.epicStatusWidth).toBeGreaterThanOrEqual(0)
      expect(w.doneCompletedWidth).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Header width regression at narrow terminals
// ---------------------------------------------------------------------------

describe("narrow-terminal header width regression", () => {
  // Simulate realistic header inputs
  const workerRunning = { state: "running", currentTaskId: "task-abc-12345" }
  const workerIdle = { state: "idle" }
  const timeStr = "12:34:56"

  it("header error budget is non-negative across narrow sweep (20–80)", () => {
    const { rightWidth } = computeHeaderRightWidth(workerRunning, 10, timeStr)
    for (let tw = 20; tw <= 80; tw++) {
      const contentWidth = Math.max(0, tw - 2)
      const budget = computeHeaderErrorBudget(contentWidth, rightWidth, 0, false)
      expect(budget).toBeGreaterThanOrEqual(0)
    }
  })

  it("total header content fits within content width when error is shown (sweep 40–200)", () => {
    const { rightWidth } = computeHeaderRightWidth(workerRunning, 15, timeStr)
    const configWidth = 30
    for (let tw = 40; tw <= 200; tw++) {
      const contentWidth = tw - 2
      const budget = computeHeaderErrorBudget(contentWidth, rightWidth, configWidth, false)
      if (budget > 0) {
        // leftFixed(14) + leftGap(1) + errorPrefix(3) + budget + rightWidth must fit
        const totalUsed = 14 + 1 + 3 + budget + rightWidth
        expect(totalUsed).toBeLessThanOrEqual(contentWidth)
      }
    }
  })

  it("total header content with config fits within content width (sweep 60–200)", () => {
    const { rightWidth } = computeHeaderRightWidth(workerIdle, 5, timeStr)
    const configWidth = 35
    for (let tw = 60; tw <= 200; tw++) {
      const contentWidth = tw - 2
      const showConfig = contentWidth >= 14 + configWidth + rightWidth + 4
      const budget = computeHeaderErrorBudget(contentWidth, rightWidth, configWidth, showConfig)
      if (budget > 0 && showConfig) {
        const totalUsed = 14 + 1 + 3 + budget + configWidth + rightWidth
        expect(totalUsed).toBeLessThanOrEqual(contentWidth)
      }
    }
  })

  it("error budget collapses to 0 at sufficiently narrow widths", () => {
    const { rightWidth } = computeHeaderRightWidth(workerRunning, 20, timeStr)
    // At very narrow widths the right section alone should consume all space
    const budget = computeHeaderErrorBudget(20, rightWidth, 0, false)
    expect(budget).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Footer width regression at narrow terminals
// ---------------------------------------------------------------------------

describe("narrow-terminal footer width regression", () => {
  it("footer text + padding never exceeds terminal width (sweep 5–120)", () => {
    // Below 5 columns the padding (2) + safety margin (2) alone exceeds
    // the terminal width — an inherent limitation at unusable widths.
    for (let tw = 5; tw <= 120; tw++) {
      const text = buildFooterText("dashboard", tw, true, true)
      // text.length + paddingLeft(1) + paddingRight(1) must fit
      expect(text.length + 2).toBeLessThanOrEqual(tw)
    }
  })

  it("detail-mode footer also fits within narrow terminals (sweep 5–80)", () => {
    for (let tw = 5; tw <= 80; tw++) {
      const text = buildFooterText("detail", tw)
      expect(text.length + 2).toBeLessThanOrEqual(tw)
    }
  })

  it("footer text is empty at terminal width 0", () => {
    expect(buildFooterText("dashboard", 0, true, true)).toBe("")
    expect(buildFooterText("detail", 0)).toBe("")
  })

  it("footer text is non-empty once terminal is wide enough for at least one shortcut", () => {
    // "^Q:Quit" is 7 chars — smallest shortcut fragment. With padding(2) + margin(2) = 4 overhead,
    // we need at least ~11 columns to show something.
    const text = buildFooterText("dashboard", 15, false, false)
    expect(text.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Cross-layer consistency: all layers safe at the same narrow width
// ---------------------------------------------------------------------------

describe("cross-layer narrow-terminal consistency", () => {
  it("pane widths, header, and footer are all safe at the same terminal width (sweep 60–160)", () => {
    // Start at 60 — the minimum where the active pane's fixed columns fit.
    for (let tw = 60; tw <= 160; tw++) {
      // Pane layer
      const panes = computePaneWidths(tw)
      expect(panes.epicPaneWidth + panes.donePaneWidth).toBeLessThanOrEqual(tw)
      expect(ACTIVE_FIXED + panes.activeTitleWidth).toBeLessThanOrEqual(tw)

      // Header layer
      const { rightWidth } = computeHeaderRightWidth(
        { state: "running", currentTaskId: "t-123" },
        8,
        "10:00:00",
      )
      const contentWidth = Math.max(0, tw - 2)
      const errorBudget = computeHeaderErrorBudget(contentWidth, rightWidth, 0, false)
      expect(errorBudget).toBeGreaterThanOrEqual(0)
      if (errorBudget > 0) {
        expect(14 + 1 + 3 + errorBudget + rightWidth).toBeLessThanOrEqual(contentWidth)
      }

      // Footer layer
      const footer = buildFooterText("dashboard", tw, true, true)
      expect(footer.length + 2).toBeLessThanOrEqual(tw)
    }
  })
})
