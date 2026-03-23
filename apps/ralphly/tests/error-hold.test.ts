/**
 * ABOUTME: Tests for the error-hold store and failure summary construction.
 * Verifies in-memory error-hold tracking, record/clear lifecycle, and
 * failure summary formatting for retry feedback.
 */

import { describe, test, expect } from "bun:test"
import { ErrorHoldStore, buildFailureSummary, type ErrorHoldRecord } from "../src/error-hold.js"

// ---------------------------------------------------------------------------
// ErrorHoldStore
// ---------------------------------------------------------------------------

describe("ErrorHoldStore", () => {
  test("starts empty", () => {
    const store = new ErrorHoldStore()
    expect(store.size).toBe(0)
    expect(store.has("issue-1")).toBe(false)
    expect(store.get("issue-1")).toBeNull()
  })

  test("records and retrieves a hold", () => {
    const store = new ErrorHoldStore()
    const record: ErrorHoldRecord = {
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Failed after 2 attempt(s): npm test failed",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    }

    store.record(record)

    expect(store.size).toBe(1)
    expect(store.has("issue-1")).toBe(true)
    expect(store.get("issue-1")).toEqual(record)
  })

  test("overwrites existing hold for same issue", () => {
    const store = new ErrorHoldStore()
    const first: ErrorHoldRecord = {
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "First failure",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    }
    const second: ErrorHoldRecord = {
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Second failure",
      failedAt: new Date("2025-06-01T11:00:00Z"),
    }

    store.record(first)
    store.record(second)

    expect(store.size).toBe(1)
    expect(store.get("issue-1")!.failureSummary).toBe("Second failure")
  })

  test("clears a hold and returns the record", () => {
    const store = new ErrorHoldStore()
    const record: ErrorHoldRecord = {
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Failed",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    }

    store.record(record)
    const cleared = store.clear("issue-1")

    expect(cleared).toEqual(record)
    expect(store.size).toBe(0)
    expect(store.has("issue-1")).toBe(false)
  })

  test("clear returns null for non-existent hold", () => {
    const store = new ErrorHoldStore()
    expect(store.clear("issue-1")).toBeNull()
  })

  test("tracks multiple issues independently", () => {
    const store = new ErrorHoldStore()

    store.record({
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Failure 1",
      failedAt: new Date("2025-06-01T10:00:00Z"),
    })
    store.record({
      issueId: "issue-2",
      sessionId: "session-2",
      failureSummary: "Failure 2",
      failedAt: new Date("2025-06-01T11:00:00Z"),
    })

    expect(store.size).toBe(2)
    expect(store.has("issue-1")).toBe(true)
    expect(store.has("issue-2")).toBe(true)

    store.clear("issue-1")
    expect(store.size).toBe(1)
    expect(store.has("issue-1")).toBe(false)
    expect(store.has("issue-2")).toBe(true)
  })

  test("heldIds returns all error-held issue IDs", () => {
    const store = new ErrorHoldStore()

    store.record({
      issueId: "issue-1",
      sessionId: "session-1",
      failureSummary: "Failure 1",
      failedAt: new Date(),
    })
    store.record({
      issueId: "issue-2",
      sessionId: "session-2",
      failureSummary: "Failure 2",
      failedAt: new Date(),
    })

    const ids = store.heldIds()
    expect(ids.has("issue-1")).toBe(true)
    expect(ids.has("issue-2")).toBe(true)
    expect(ids.size).toBe(2)
  })
})

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
