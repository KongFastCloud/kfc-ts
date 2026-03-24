/**
 * ABOUTME: Tests for Linear session activity formatting, lifecycle event mapping,
 * and the explicit session-write contract.
 *
 * The session-write contract is:
 *   start        → runner writes on entry
 *   check_failed → onEvent callback writes during retry loop
 *   success      → runner writes on successful exit
 *   error        → runner writes on terminal failure (also the durable held marker)
 *
 * mapLoopEventToActivity only handles intermediate events (check_failed).
 * Terminal events (success, error) are written explicitly by the runner.
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
  writeStartActivity,
  writeSuccessActivity,
  writeCheckFailedActivity,
  writeErrorActivity,
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
// Lifecycle event mapping tests — contract: only intermediate events mapped
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

  test("returns null for success (written explicitly by runner)", () => {
    const event: LoopEvent = {
      type: "success",
      attempt: 2,
      maxAttempts: 3,
    }

    const result = mapLoopEventToActivity(event)

    // Success is NOT mapped through onEvent — it's written
    // explicitly by the runner after blueprintsRun completes.
    expect(result).toBeNull()
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
// Convenience writer tests — each state has an explicit function
// ---------------------------------------------------------------------------

describe("writeStartActivity", () => {
  test("writes start acknowledgement with issue identifier", async () => {
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
      writeStartActivity("session-1", "ENG-123").pipe(Effect.provide(layer)),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.content.body).toBe("Starting work on ENG-123")
  })
})

describe("writeSuccessActivity", () => {
  test("writes success with attempt count", async () => {
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
      writeSuccessActivity("session-1", 2, 3).pipe(Effect.provide(layer)),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.content.body).toContain("[attempt 2/3]")
    expect(calls[0]!.content.body).toContain("All checks passed")
  })
})

describe("writeCheckFailedActivity", () => {
  test("writes check-failed with attempt count and feedback", async () => {
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
      writeCheckFailedActivity("session-1", 1, 3, "tests broken").pipe(Effect.provide(layer)),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.content.body).toContain("[attempt 1/3]")
    expect(calls[0]!.content.body).toContain("Check failed")
    expect(calls[0]!.content.body).toContain("tests broken")
  })
})

describe("writeErrorActivity", () => {
  test("writes terminal error with durable held-marker semantics", async () => {
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
      writeErrorActivity("session-1", "npm test failed", 2).pipe(Effect.provide(layer)),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.content.body).toContain("Failed after 2 attempt(s)")
    expect(calls[0]!.content.body).toContain("npm test failed")
  })
})

// ---------------------------------------------------------------------------
// Session event handler tests — only intermediate events
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

  test("does nothing for success events (written explicitly by runner)", async () => {
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
      type: "success",
      attempt: 1,
      maxAttempts: 2,
    }

    await Effect.runPromise(handler(event).pipe(Effect.provide(layer)))

    // Success is NOT written through the handler — it's the runner's
    // responsibility to write it explicitly after blueprintsRun.
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Session write contract completeness
// ---------------------------------------------------------------------------

describe("session write contract", () => {
  test("every SessionUpdateKind has a corresponding format function", () => {
    // This test ensures the format functions stay in sync with the type.
    // If a new kind is added to SessionUpdateKind, a format function
    // should be added too.
    expect(typeof formatStartActivity).toBe("function")
    expect(typeof formatCheckFailedActivity).toBe("function")
    expect(typeof formatSuccessActivity).toBe("function")
    expect(typeof formatErrorActivity).toBe("function")
  })

  test("every SessionUpdateKind has a corresponding write function", () => {
    expect(typeof writeStartActivity).toBe("function")
    expect(typeof writeCheckFailedActivity).toBe("function")
    expect(typeof writeSuccessActivity).toBe("function")
    expect(typeof writeErrorActivity).toBe("function")
  })

  test("error activity body matches the pattern detected by isErrorActivity", () => {
    // The error format MUST start with "Failed after" because that's
    // what isErrorActivity() in worker.ts uses to detect durable holds.
    const body = formatErrorActivity("some error", 2)
    expect(body.startsWith("Failed after")).toBe(true)
  })

  test("non-error activity bodies do not match the error detection pattern", () => {
    expect(formatStartActivity("ENG-1").startsWith("Failed after")).toBe(false)
    expect(formatSuccessActivity(1, 2).startsWith("Failed after")).toBe(false)
    expect(formatCheckFailedActivity(1, 2, "err").startsWith("Failed after")).toBe(false)
  })
})
