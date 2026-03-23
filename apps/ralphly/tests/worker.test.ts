/**
 * ABOUTME: Tests for the worker loop, error-hold behavior, and
 * prompted follow-up retry detection.
 */

import { describe, test, expect } from "bun:test"
import { findPromptedFollowUp } from "../src/worker.js"
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
