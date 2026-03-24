/**
 * Google Chat adapter integration tests.
 *
 * These tests exercise the full handler chain. The chat bridge and
 * runtime are mocked via node:test mock.module so tests run without
 * real API credentials while still verifying the complete request path.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Effect, Exit } from "effect"

// ── Mock the chat bridge ────────────────────────────────────────
interface MockChatRequest {
  threadId: string
  userId: string
  text: string
}

interface MockChatResponse {
  text: string
}

const generateReplyMock = mock.fn(
  (_req: MockChatRequest): Effect.Effect<MockChatResponse, unknown> =>
    Effect.succeed({ text: "Mock reply from Repochat" }),
)

mock.module("../chat.ts", {
  namedExports: { generateReply: generateReplyMock },
})

// Mock the runtime to run Effect programs directly
mock.module("../runtime.ts", {
  namedExports: {
    runtime: {
      runPromiseExit: async (effect: Effect.Effect<unknown, unknown, never>) =>
        Effect.runPromiseExit(effect as Effect.Effect<unknown, unknown, never>),
    },
  },
})

// Import handler AFTER the mocks are registered
const { handler } = await import("../handler.ts")

// ── Helpers ─────────────────────────────────────────────────────

const webhookRequest = (payload: unknown): Request =>
  new Request("http://localhost:4320/google-chat/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  })

const makeMessagePayload = (overrides?: Record<string, unknown>) => ({
  type: "MESSAGE",
  eventTime: "2026-03-24T00:00:00Z",
  message: {
    name: "spaces/SPACE1/messages/MSG1",
    sender: { name: "users/112233", displayName: "Test User", type: "HUMAN" },
    createTime: "2026-03-24T00:00:00Z",
    text: "@Repochat what is this repo?",
    argumentText: "what is this repo?",
    thread: { name: "spaces/SPACE1/threads/THREAD1" },
    space: { name: "spaces/SPACE1", type: "ROOM" },
    ...overrides,
  },
})

// ── Tests ───────────────────────────────────────────────────────

describe("handler routing", () => {
  it("GET /health returns ok", async () => {
    const req = new Request("http://localhost:4320/health")
    const res = await handler(req)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.service, "repochat")
  })

  it("unknown route returns 404", async () => {
    const req = new Request("http://localhost:4320/unknown")
    const res = await handler(req)
    assert.equal(res.status, 404)
  })

  it("POST /google-chat/webhook with invalid JSON returns 400", async () => {
    const req = new Request("http://localhost:4320/google-chat/webhook", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    })
    const res = await handler(req)
    assert.equal(res.status, 400)
  })

  it("POST /google-chat/webhook ADDED_TO_SPACE returns greeting", async () => {
    const payload = {
      type: "ADDED_TO_SPACE",
      eventTime: "2026-03-24T00:00:00Z",
      space: { name: "spaces/ABCDEF", type: "ROOM" },
      user: { name: "users/112233", displayName: "Test User", type: "HUMAN" },
    }
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.text.includes("Repochat"))
  })

  it("POST /google-chat/webhook REMOVED_FROM_SPACE returns empty 200", async () => {
    const payload = {
      type: "REMOVED_FROM_SPACE",
      eventTime: "2026-03-24T00:00:00Z",
      space: { name: "spaces/ABCDEF", type: "ROOM" },
    }
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.equal(text, "")
  })
})

describe("Google Chat MESSAGE handling", () => {
  beforeEach(() => {
    generateReplyMock.mock.resetCalls()
    generateReplyMock.mock.mockImplementation(
      (_req: MockChatRequest): Effect.Effect<MockChatResponse, unknown> =>
        Effect.succeed({ text: "Mock reply from Repochat" }),
    )
  })

  it("routes a MESSAGE event through the chat bridge and returns the reply", async () => {
    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.text, "Mock reply from Repochat")
  })

  it("passes platform-qualified threadId and userId to the chat bridge", async () => {
    const payload = makeMessagePayload()
    await handler(webhookRequest(payload))

    assert.equal(generateReplyMock.mock.callCount(), 1)
    const call = generateReplyMock.mock.calls[0]!.arguments[0] as MockChatRequest
    assert.equal(call.threadId, "gchat:spaces/SPACE1/threads/THREAD1")
    assert.equal(call.userId, "gchat:users/112233")
  })

  it("uses argumentText (stripped @mention) as the message text", async () => {
    const payload = makeMessagePayload({
      text: "@Repochat what is this repo?",
      argumentText: "what is this repo?",
    })
    await handler(webhookRequest(payload))

    const call = generateReplyMock.mock.calls[0]!.arguments[0] as MockChatRequest
    assert.equal(call.text, "what is this repo?")
  })

  it("falls back to text when argumentText is absent", async () => {
    const payload = makeMessagePayload({
      text: "hello bot",
      argumentText: undefined,
    })
    await handler(webhookRequest(payload))

    const call = generateReplyMock.mock.calls[0]!.arguments[0] as MockChatRequest
    assert.equal(call.text, "hello bot")
  })

  it("echoes the thread name in the response for threading", async () => {
    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))
    const body = await res.json()
    assert.equal(body.thread.name, "spaces/SPACE1/threads/THREAD1")
  })

  it("returns a friendly error when the chat bridge fails", async () => {
    generateReplyMock.mock.mockImplementation(
      (): Effect.Effect<MockChatResponse, unknown> =>
        Effect.fail({ _tag: "AgentError", message: "gateway timeout" }),
    )

    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.text.includes("error"))
  })

  it("returns a fallback when message text is empty", async () => {
    const payload = makeMessagePayload({ text: "", argumentText: "" })
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.text.includes("didn't catch"))
    // Should NOT have called generateReply
    assert.equal(generateReplyMock.mock.callCount(), 0)
  })

  it("handles MESSAGE event missing the message field", async () => {
    const payload = {
      type: "MESSAGE",
      eventTime: "2026-03-24T00:00:00Z",
    }
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 400)
  })

  it("does not include extra fields in the success response beyond text and thread", async () => {
    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))
    const body = await res.json()
    const keys = Object.keys(body).sort()
    assert.deepEqual(keys, ["text", "thread"], "response should contain only text and thread")
  })

  it("error response does not leak internal error details to the user", async () => {
    generateReplyMock.mock.mockImplementation(
      (): Effect.Effect<MockChatResponse, unknown> =>
        Effect.fail({ _tag: "AgentError", message: "internal: connection reset by peer" }),
    )

    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))
    const body = await res.json()

    // User-facing message should be friendly, not expose internals
    assert.ok(!body.text.includes("connection reset"), "should not leak internal error message")
    assert.ok(body.text.includes("error"), "should contain friendly error wording")
  })

  it("returns HTTP 200 even on chat bridge failure (Google Chat expects 200)", async () => {
    generateReplyMock.mock.mockImplementation(
      (): Effect.Effect<MockChatResponse, unknown> =>
        Effect.fail({ _tag: "AgentError", message: "model overloaded" }),
    )

    const payload = makeMessagePayload()
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 200, "should return 200 even on failure for Google Chat compatibility")
  })
})

describe("Google Chat event handling — edge cases", () => {
  it("CARD_CLICKED event is acknowledged silently with empty 200", async () => {
    const payload = {
      type: "CARD_CLICKED",
      eventTime: "2026-03-24T00:00:00Z",
    }
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.equal(text, "")
  })

  it("unknown event type is acknowledged silently with empty 200", async () => {
    const payload = {
      type: "SOME_FUTURE_EVENT",
      eventTime: "2026-03-24T00:00:00Z",
    }
    const res = await handler(webhookRequest(payload))
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.equal(text, "")
  })
})

describe("Google Chat concurrency", () => {
  beforeEach(() => {
    generateReplyMock.mock.resetCalls()
  })

  it("concurrent messages on the SAME thread are serialised (FIFO)", async () => {
    const order: number[] = []
    let callCount = 0

    generateReplyMock.mock.mockImplementation(
      (_req: MockChatRequest): Effect.Effect<MockChatResponse, unknown> => {
        const idx = ++callCount
        return Effect.promise(async () => {
          order.push(idx)
          // Small delay to ensure concurrency window
          await new Promise((r) => setTimeout(r, 20))
          return { text: `reply-${idx}` }
        })
      },
    )

    // Both use the same thread
    const payload1 = makeMessagePayload({ argumentText: "first" })
    const payload2 = makeMessagePayload({ argumentText: "second" })

    const [res1, res2] = await Promise.all([
      handler(webhookRequest(payload1)),
      handler(webhookRequest(payload2)),
    ])

    assert.equal(res1.status, 200)
    assert.equal(res2.status, 200)
    assert.equal(order.length, 2)
    assert.equal(order[0], 1, "first message should be processed first")
    assert.equal(order[1], 2, "second message should be processed second")
  })

  it("concurrent messages on DIFFERENT threads run in parallel", async () => {
    const active = new Set<string>()
    let maxConcurrent = 0

    generateReplyMock.mock.mockImplementation(
      (req: MockChatRequest): Effect.Effect<MockChatResponse, unknown> => {
        return Effect.promise(async () => {
          active.add(req.threadId)
          maxConcurrent = Math.max(maxConcurrent, active.size)
          await new Promise((r) => setTimeout(r, 20))
          active.delete(req.threadId)
          return { text: "ok" }
        })
      },
    )

    // Use different threads
    const payload1 = makeMessagePayload({
      thread: { name: "spaces/SPACE1/threads/THREAD_A" },
    })
    const payload2 = makeMessagePayload({
      thread: { name: "spaces/SPACE1/threads/THREAD_B" },
    })

    await Promise.all([
      handler(webhookRequest(payload1)),
      handler(webhookRequest(payload2)),
    ])

    assert.equal(maxConcurrent, 2, "different threads should run concurrently")
  })

  it("lock is released after chat bridge failure (no deadlock)", async () => {
    generateReplyMock.mock.mockImplementation(
      (): Effect.Effect<MockChatResponse, unknown> =>
        Effect.fail({ _tag: "AgentError", message: "boom" }),
    )

    // First request fails
    const payload1 = makeMessagePayload({ argumentText: "will fail" })
    const res1 = await handler(webhookRequest(payload1))
    assert.equal(res1.status, 200) // graceful error

    // Second request on same thread should NOT deadlock
    generateReplyMock.mock.mockImplementation(
      (_req: MockChatRequest): Effect.Effect<MockChatResponse, unknown> =>
        Effect.succeed({ text: "recovered" }),
    )

    const payload2 = makeMessagePayload({ argumentText: "should work" })
    const res2 = await handler(webhookRequest(payload2))
    assert.equal(res2.status, 200)
    const body2 = await res2.json()
    assert.equal(body2.text, "recovered", "second request should succeed after first failure")
  })
})
