/**
 * ABOUTME: Tests for Linear session activity formatting and lifecycle event mapping.
 * Verifies the explicit mapping from blueprints lifecycle events to Linear
 * session activities — the core testable contract for this slice.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { LoopEvent } from "@workspace/blueprints"
import { Linear } from "../../src/linear/client.js"
import {
  formatStartActivity,
  formatCheckFailedActivity,
  formatSuccessActivity,
  formatErrorActivity,
  mapLoopEventToActivity,
  writeSessionActivity,
  makeSessionEventHandler,
} from "../../src/linear/activities.js"

// ---------------------------------------------------------------------------
// Formatting tests
// ---------------------------------------------------------------------------

describe("formatStartActivity", () => {
  test("includes issue identifier", () => {
    const body = formatStartActivity("ENG-123")
    expect(body).toBe("Starting work on ENG-123")
  })
})

describe("formatCheckFailedActivity", () => {
  test("includes attempt count and feedback", () => {
    const body = formatCheckFailedActivity(1, 3, "npm test exited 1")
    expect(body).toContain("[attempt 1/3]")
    expect(body).toContain("Check failed")
    expect(body).toContain("npm test exited 1")
  })
})

describe("formatSuccessActivity", () => {
  test("includes attempt count and check mark", () => {
    const body = formatSuccessActivity(2, 3)
    expect(body).toContain("[attempt 2/3]")
    expect(body).toContain("All checks passed")
  })
})

describe("formatErrorActivity", () => {
  test("includes error and attempt count", () => {
    const body = formatErrorActivity("timeout exceeded", 3)
    expect(body).toContain("Failed after 3 attempt(s)")
    expect(body).toContain("timeout exceeded")
  })

  test("handles single attempt", () => {
    const body = formatErrorActivity("auth failure", 1)
    expect(body).toContain("Failed after 1 attempt(s)")
  })
})

// ---------------------------------------------------------------------------
// Lifecycle event mapping tests
// ---------------------------------------------------------------------------

describe("mapLoopEventToActivity", () => {
  test("maps check_failed event to check_failed activity", () => {
    const event: LoopEvent = {
      type: "check_failed",
      attempt: 1,
      maxAttempts: 3,
      feedback: "npm test failed",
    }

    const result = mapLoopEventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe("check_failed")
    expect(result!.body).toContain("[attempt 1/3]")
    expect(result!.body).toContain("npm test failed")
  })

  test("maps success event to success activity", () => {
    const event: LoopEvent = {
      type: "success",
      attempt: 2,
      maxAttempts: 3,
    }

    const result = mapLoopEventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe("success")
    expect(result!.body).toContain("[attempt 2/3]")
    expect(result!.body).toContain("All checks passed")
  })

  test("returns null for attempt_start (handled separately)", () => {
    const event: LoopEvent = {
      type: "attempt_start",
      attempt: 1,
      maxAttempts: 3,
    }

    const result = mapLoopEventToActivity(event)
    expect(result).toBeNull()
  })

  test("handles check_failed with no feedback", () => {
    const event: LoopEvent = {
      type: "check_failed",
      attempt: 1,
      maxAttempts: 2,
    }

    const result = mapLoopEventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe("check_failed")
    // Should still produce a body even without feedback
    expect(result!.body).toContain("[attempt 1/2]")
  })
})

// ---------------------------------------------------------------------------
// Session activity writer tests (with mock client)
// ---------------------------------------------------------------------------

describe("writeSessionActivity", () => {
  test("calls createAgentActivity on the Linear client", async () => {
    const calls: Array<{ agentSessionId: string; content: { type: string; body: string } }> = []

    const mockClient = {
      createAgentActivity: async (input: { agentSessionId: string; content: { type: string; body: string } }) => {
        calls.push(input)
        return { success: true }
      },
    }

    const layer = Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    )

    await Effect.runPromise(
      writeSessionActivity("session-1", "Hello from test").pipe(Effect.provide(layer)),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.agentSessionId).toBe("session-1")
    expect(calls[0]!.content.type).toBe("thought")
    expect(calls[0]!.content.body).toBe("Hello from test")
  })

  test("does not throw on API failure (fire-and-forget)", async () => {
    const mockClient = {
      createAgentActivity: async () => {
        throw new Error("API down")
      },
    }

    const layer = Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    )

    // Should complete without throwing
    await Effect.runPromise(
      writeSessionActivity("session-1", "Hello").pipe(Effect.provide(layer)),
    )
  })
})

// ---------------------------------------------------------------------------
// Session event handler tests
// ---------------------------------------------------------------------------

describe("makeSessionEventHandler", () => {
  test("writes activity for check_failed events", async () => {
    const calls: Array<{ agentSessionId: string; content: { type: string; body: string } }> = []

    const mockClient = {
      createAgentActivity: async (input: { agentSessionId: string; content: { type: string; body: string } }) => {
        calls.push(input)
        return { success: true }
      },
    }

    const layer = Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    )

    const handler = makeSessionEventHandler("session-42")
    const event: LoopEvent = {
      type: "check_failed",
      attempt: 1,
      maxAttempts: 2,
      feedback: "tests broken",
    }

    await Effect.runPromise(handler(event).pipe(Effect.provide(layer)))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.agentSessionId).toBe("session-42")
    expect(calls[0]!.content.body).toContain("Check failed")
    expect(calls[0]!.content.body).toContain("tests broken")
  })

  test("does nothing for attempt_start events", async () => {
    const calls: unknown[] = []

    const mockClient = {
      createAgentActivity: async (input: unknown) => {
        calls.push(input)
        return { success: true }
      },
    }

    const layer = Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    )

    const handler = makeSessionEventHandler("session-42")
    const event: LoopEvent = {
      type: "attempt_start",
      attempt: 1,
      maxAttempts: 2,
    }

    await Effect.runPromise(handler(event).pipe(Effect.provide(layer)))

    expect(calls).toHaveLength(0)
  })

  test("writes activity for success events", async () => {
    const calls: Array<{ agentSessionId: string; content: { type: string; body: string } }> = []

    const mockClient = {
      createAgentActivity: async (input: { agentSessionId: string; content: { type: string; body: string } }) => {
        calls.push(input)
        return { success: true }
      },
    }

    const layer = Layer.succeed(
      Linear,
      mockClient as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
    )

    const handler = makeSessionEventHandler("session-42")
    const event: LoopEvent = {
      type: "success",
      attempt: 1,
      maxAttempts: 2,
    }

    await Effect.runPromise(handler(event).pipe(Effect.provide(layer)))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.content.body).toContain("All checks passed")
  })
})
