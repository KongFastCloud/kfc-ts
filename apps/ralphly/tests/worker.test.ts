/**
 * ABOUTME: Tests for the worker loop helpers: prompted follow-up detection
 * and Linear-derived error activity detection.
 *
 * These helpers derive queue truth from Linear session activities rather
 * than from a private in-memory hold store.
 */

import { describe, test, expect } from "bun:test"
import {
  findPromptedFollowUp,
  findLastErrorTimestamp,
  findLastErrorSummary,
  isErrorActivity,
  getActivityBody,
} from "../src/worker.js"
import type { SessionPrompt } from "../src/linear/types.js"

// ---------------------------------------------------------------------------
// findPromptedFollowUp
// ---------------------------------------------------------------------------

describe("findPromptedFollowUp", () => {
  const failedAt = new Date("2025-06-01T10:00:00Z")

  test("returns null when no activities exist", () => {
    const result = findPromptedFollowUp([], failedAt)
    expect(result).toBeNull()
  })

  test("returns null when no prompt activities exist after failure", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Processing..." },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBeNull()
  })

  test("returns null when prompt activities are before failure", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: "Original delegation" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBeNull()
  })

  test("returns prompt body when prompted after failure", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: "Try again with the new dependency installed" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBe("Try again with the new dependency installed")
  })

  test("returns newest prompt when multiple follow-ups exist", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: "First follow-up" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
      {
        id: "a2",
        type: "prompt",
        content: { body: "Latest follow-up" },
        createdAt: new Date("2025-06-01T12:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBe("Latest follow-up")
  })

  test("ignores non-prompt activities after failure", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Agent thinking..." },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
      {
        id: "a2",
        type: "response",
        content: { body: "Agent response" },
        createdAt: new Date("2025-06-01T11:30:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBeNull()
  })

  test("returns fallback when prompt has no body field", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { someOtherField: "value" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBe("(follow-up prompt)")
  })

  test("returns fallback when prompt body is not a string", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: 42 },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBe("(follow-up prompt)")
  })

  test("filters prompts at exactly the failure time", () => {
    // Prompts at exactly the failure time should NOT be considered follow-ups
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: "At failure time" },
        createdAt: failedAt,
      },
    ]
    const result = findPromptedFollowUp(activities, failedAt)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isErrorActivity
// ---------------------------------------------------------------------------

describe("isErrorActivity", () => {
  test("matches thought activity with error format body", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: "Failed after 2 attempt(s): npm test exited with code 1" },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }
    expect(isErrorActivity(activity)).toBe(true)
  })

  test("does not match thought activity without error format", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: "Starting work on ENG-123" },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }
    expect(isErrorActivity(activity)).toBe(false)
  })

  test("does not match prompt activity even with error format body", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "prompt",
      content: { body: "Failed after 1 attempt(s): something broke" },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }
    expect(isErrorActivity(activity)).toBe(false)
  })

  test("does not match thought activity with no body", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { someOtherField: "value" },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }
    expect(isErrorActivity(activity)).toBe(false)
  })

  test("does not match thought activity with non-string body", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: 42 },
      createdAt: new Date("2025-06-01T10:00:00Z"),
    }
    expect(isErrorActivity(activity)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getActivityBody
// ---------------------------------------------------------------------------

describe("getActivityBody", () => {
  test("extracts string body from content", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: "Hello world" },
      createdAt: new Date(),
    }
    expect(getActivityBody(activity)).toBe("Hello world")
  })

  test("returns undefined when body is missing", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { other: "field" },
      createdAt: new Date(),
    }
    expect(getActivityBody(activity)).toBeUndefined()
  })

  test("returns undefined when body is not a string", () => {
    const activity: SessionPrompt = {
      id: "a1",
      type: "thought",
      content: { body: 123 },
      createdAt: new Date(),
    }
    expect(getActivityBody(activity)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// findLastErrorTimestamp
// ---------------------------------------------------------------------------

describe("findLastErrorTimestamp", () => {
  test("returns null when no activities exist", () => {
    expect(findLastErrorTimestamp([])).toBeNull()
  })

  test("returns null when no error activities exist", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      {
        id: "a2",
        type: "thought",
        content: { body: "[attempt 1/2] All checks passed ✓" },
        createdAt: new Date("2025-06-01T10:30:00Z"),
      },
    ]
    expect(findLastErrorTimestamp(activities)).toBeNull()
  })

  test("returns timestamp of the last error activity", () => {
    const errorTime = new Date("2025-06-01T10:30:00Z")
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      {
        id: "a2",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): npm test exited with code 1" },
        createdAt: errorTime,
      },
    ]
    expect(findLastErrorTimestamp(activities)).toEqual(errorTime)
  })

  test("returns the LAST error timestamp when multiple errors exist", () => {
    const firstError = new Date("2025-06-01T10:00:00Z")
    const secondError = new Date("2025-06-01T12:00:00Z")
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Failed after 1 attempt(s): first failure" },
        createdAt: firstError,
      },
      {
        id: "a2",
        type: "prompt",
        content: { body: "Try again" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
      {
        id: "a3",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): second failure" },
        createdAt: secondError,
      },
    ]
    expect(findLastErrorTimestamp(activities)).toEqual(secondError)
  })

  test("ignores prompt activities with error-like text", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "prompt",
        content: { body: "Failed after 1 attempt(s): this is a prompt not an error" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
    ]
    expect(findLastErrorTimestamp(activities)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findLastErrorSummary
// ---------------------------------------------------------------------------

describe("findLastErrorSummary", () => {
  test("returns null when no activities exist", () => {
    expect(findLastErrorSummary([])).toBeNull()
  })

  test("returns null when no error activities exist", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
    ]
    expect(findLastErrorSummary(activities)).toBeNull()
  })

  test("returns the body of the last error activity", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a1",
        type: "thought",
        content: { body: "Failed after 1 attempt(s): first failure" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      {
        id: "a2",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): second failure" },
        createdAt: new Date("2025-06-01T12:00:00Z"),
      },
    ]
    expect(findLastErrorSummary(activities)).toBe(
      "Failed after 2 attempt(s): second failure",
    )
  })
})

// ---------------------------------------------------------------------------
// Error → follow-up → retry integration (derived from Linear activities)
// ---------------------------------------------------------------------------

describe("error → follow-up → retry flow (Linear-derived)", () => {
  test("error activity followed by prompted follow-up enables retry", () => {
    const errorTime = new Date("2025-06-01T10:00:00Z")
    const activities: SessionPrompt[] = [
      {
        id: "a-start",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): npm test failed" },
        createdAt: errorTime,
      },
      {
        id: "a-followup",
        type: "prompt",
        content: { body: "I installed the missing dependency, try again" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ]

    // Derive error timestamp from activities
    const errorTimestamp = findLastErrorTimestamp(activities)
    expect(errorTimestamp).toEqual(errorTime)

    // Derive error summary from activities
    const errorSummary = findLastErrorSummary(activities)
    expect(errorSummary).toBe("Failed after 2 attempt(s): npm test failed")

    // Detect follow-up after error
    const followUp = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUp).toBe("I installed the missing dependency, try again")

    // Build combined feedback (as the worker would)
    const feedback = [errorSummary, `\nUser follow-up: ${followUp}`].join("\n")
    expect(feedback).toContain("Failed after 2 attempt(s)")
    expect(feedback).toContain("I installed the missing dependency")
  })

  test("error activity without follow-up does not enable retry", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a-start",
        type: "thought",
        content: { body: "Starting work on ENG-1" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): npm test failed" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
    ]

    const errorTimestamp = findLastErrorTimestamp(activities)
    expect(errorTimestamp).not.toBeNull()

    const followUp = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUp).toBeNull()
  })

  test("follow-up before error does not enable retry", () => {
    const activities: SessionPrompt[] = [
      {
        id: "a-prompt",
        type: "prompt",
        content: { body: "Original delegation" },
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "a-error",
        type: "thought",
        content: { body: "Failed after 1 attempt(s): build error" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
    ]

    const errorTimestamp = findLastErrorTimestamp(activities)
    const followUp = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUp).toBeNull()
  })

  test("multiple error-retry cycles: only last error matters", () => {
    const activities: SessionPrompt[] = [
      // First error
      {
        id: "a1",
        type: "thought",
        content: { body: "Failed after 1 attempt(s): first failure" },
        createdAt: new Date("2025-06-01T10:00:00Z"),
      },
      // Follow-up that cleared first error
      {
        id: "a2",
        type: "prompt",
        content: { body: "Fixed the config, try again" },
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
      // Second error
      {
        id: "a3",
        type: "thought",
        content: { body: "Failed after 2 attempt(s): second failure" },
        createdAt: new Date("2025-06-01T12:00:00Z"),
      },
    ]

    // Should find the LAST error timestamp
    const errorTimestamp = findLastErrorTimestamp(activities)
    expect(errorTimestamp).toEqual(new Date("2025-06-01T12:00:00Z"))

    // The follow-up at 11:00 is BEFORE the second error — no retry available
    const followUp = findPromptedFollowUp(activities, errorTimestamp!)
    expect(followUp).toBeNull()

    // The error summary should be from the second error
    const summary = findLastErrorSummary(activities)
    expect(summary).toBe("Failed after 2 attempt(s): second failure")
  })
})
