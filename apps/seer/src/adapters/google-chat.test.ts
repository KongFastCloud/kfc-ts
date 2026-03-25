/**
 * Google Chat SDK integration tests.
 *
 * These tests verify that handler.ts correctly delegates the
 * /google-chat/webhook route to the Chat SDK's webhook handler
 * (bot.webhooks.gchat). The bot module is mocked so tests do not
 * require Google Chat API credentials.
 *
 * The tests also verify that non-chat routes (health, 404, branch-update)
 * remain unaffected by the SDK migration.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert/strict"

// ── Mock the bot module ─────────────────────────────────────────
// The real bot.ts creates a GoogleChatAdapter at module scope which
// requires credentials. Mock it to provide a controllable webhook handler.

const webhookGchatMock = mock.fn(
  async (_request: Request): Promise<Response> =>
    new Response(JSON.stringify({ text: "SDK handled" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
)

mock.module("../bot.ts", {
  namedExports: {
    bot: {
      webhooks: {
        gchat: webhookGchatMock,
      },
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

// ── Tests ───────────────────────────────────────────────────────

describe("handler routing (preserved routes)", () => {
  it("GET /health returns ok", async () => {
    const req = new Request("http://localhost:4320/health")
    const res = await handler(req)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.service, "seer")
  })

  it("unknown route returns 404", async () => {
    const req = new Request("http://localhost:4320/unknown")
    const res = await handler(req)
    assert.equal(res.status, 404)
  })
})

describe("Google Chat webhook delegation to SDK", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    webhookGchatMock.mock.mockImplementation(
      async (_request: Request): Promise<Response> =>
        new Response(JSON.stringify({ text: "SDK handled" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
  })

  it("POST /google-chat/webhook delegates to bot.webhooks.gchat", async () => {
    const payload = {
      type: "MESSAGE",
      eventTime: "2026-03-24T00:00:00Z",
      message: {
        name: "spaces/SPACE1/messages/MSG1",
        sender: { name: "users/112233", displayName: "Test User", type: "HUMAN" },
        createTime: "2026-03-24T00:00:00Z",
        text: "what is this repo?",
        thread: { name: "spaces/SPACE1/threads/THREAD1" },
        space: { name: "spaces/SPACE1", type: "ROOM" },
      },
    }
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1, "should delegate to SDK webhook handler")

    const body = await res.json()
    assert.equal(body.text, "SDK handled")
  })

  it("passes the original Request object to the SDK webhook handler", async () => {
    const payload = { type: "MESSAGE" }
    await handler(webhookRequest(payload))

    const call = webhookGchatMock.mock.calls[0]!
    const passedRequest = call.arguments[0] as Request
    assert.ok(passedRequest instanceof Request, "should pass a Request object")
    assert.equal(passedRequest.method, "POST")
    assert.ok(
      passedRequest.url.includes("/google-chat/webhook"),
      "should pass the original URL",
    )
  })

  it("returns the SDK response directly (no wrapping)", async () => {
    webhookGchatMock.mock.mockImplementation(
      async (): Promise<Response> =>
        new Response(null, { status: 200 }),
    )

    const payload = { type: "REMOVED_FROM_SPACE" }
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
  })

  it("propagates SDK error responses", async () => {
    webhookGchatMock.mock.mockImplementation(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    )

    const payload = { invalid: true }
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 400)
  })

  it("the webhook route path is /google-chat/webhook (unchanged)", async () => {
    const req = new Request("http://localhost:4320/google-chat/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "MESSAGE" }),
      headers: { "content-type": "application/json" },
    })
    const res = await handler(req)
    assert.notEqual(res.status, 404, "webhook route should not return 404")
    assert.equal(webhookGchatMock.mock.callCount(), 1)
  })

  it("does not delegate non-webhook POST routes to the SDK", async () => {
    const req = new Request("http://localhost:4320/health")
    await handler(req)
    assert.equal(webhookGchatMock.mock.callCount(), 0, "health route should not call SDK")
  })
})

describe("GitLab webhook route is unaffected", () => {
  it("POST /webhook/branch-update is still routed (not 404)", async () => {
    const req = new Request("http://localhost:4320/webhook/branch-update", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/main" }),
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Push Hook",
      },
    })
    const res = await handler(req)
    assert.notEqual(res.status, 404, "branch-update route should not return 404")
  })
})
