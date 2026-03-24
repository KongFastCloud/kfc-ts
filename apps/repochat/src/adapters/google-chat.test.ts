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
})
