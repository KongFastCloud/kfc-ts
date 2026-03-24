/**
 * ABOUTME: Tests for failure summary construction.
 * Verifies formatting and truncation of error messages for retry feedback.
 *
 * Error-held state is derived from Linear session status — no private
 * in-memory hold store exists.
 */

import { describe, test, expect } from "bun:test"
import { buildFailureSummary } from "../src/error-hold.js"

// ---------------------------------------------------------------------------
// buildFailureSummary
// ---------------------------------------------------------------------------

describe("buildFailureSummary", () => {
  test("formats error with attempt count", () => {
    const summary = buildFailureSummary("npm test failed", 2)
    expect(summary).toBe("Failed after 2 attempt(s): npm test failed")
  })

  test("handles undefined error", () => {
    const summary = buildFailureSummary(undefined, 1)
    expect(summary).toBe("Failed after 1 attempt(s): Unknown error")
  })

  test("truncates long error messages", () => {
    const longError = "x".repeat(600)
    const summary = buildFailureSummary(longError, 3)

    expect(summary.length).toBeLessThanOrEqual(600)
    expect(summary).toContain("...")
    expect(summary).toContain("Failed after 3 attempt(s):")
  })

  test("does not truncate short error messages", () => {
    const summary = buildFailureSummary("Short error", 1)
    expect(summary).toBe("Failed after 1 attempt(s): Short error")
    expect(summary).not.toContain("...")
  })
})
