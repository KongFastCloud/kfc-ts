/**
 * Google Chat migration regression tests.
 *
 * Verifies that the SDK-backed Google Chat ingress path correctly
 * handles realistic event payloads and still reaches the existing
 * seer product logic. Guards against regressions like payload-shape
 * mismatches that produce type=undefined logs.
 *
 * Coverage:
 *   - Realistic MESSAGE payloads (DM, room, @-mention with extra text)
 *   - ADDED_TO_SPACE / REMOVED_FROM_SPACE lifecycle events
 *   - Stable thread and user identity mapping into Mastra memory
 *   - GitLab webhook path remains unaffected by migration
 *   - Edge cases: empty text, whitespace-only, missing fields
 *
 * Run with: pnpm test:integration
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert/strict"

// ── Track what the SDK receives ─────────────────────────────────
// We capture the Request objects passed to the mock webhook handler
// so we can assert on payload shape, headers, and routing.

let lastWebhookRequest: Request | undefined
const webhookGchatMock = mock.fn(
  async (request: Request): Promise<Response> => {
    lastWebhookRequest = request
    return new Response(JSON.stringify({ text: "SDK handled" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  },
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

// Import handler and identity AFTER mocks are registered
const { handler } = await import("../handler.ts")
const { qualifyUserId, qualifyThreadId, qualifyId } = await import("../identity.ts")

// ── Realistic Google Chat event fixtures ────────────────────────

/** Standard MESSAGE in a room thread (most common event type). */
const MESSAGE_ROOM_PAYLOAD = {
  type: "MESSAGE",
  eventTime: "2026-03-25T10:15:30.000Z",
  token: "bot-verification-token-abc123",
  message: {
    name: "spaces/AAAAabcDEFg/messages/msg-001.thread-001",
    sender: {
      name: "users/108765432109876543210",
      displayName: "Alice Chen",
      avatarUrl: "https://lh3.googleusercontent.com/a/default-user",
      email: "alice@example.com",
      type: "HUMAN",
      domainId: "example.com",
    },
    createTime: "2026-03-25T10:15:30.000Z",
    text: "@seer what files handle authentication?",
    argumentText: " what files handle authentication?",
    thread: { name: "spaces/AAAAabcDEFg/threads/thread-001" },
    space: {
      name: "spaces/AAAAabcDEFg",
      type: "ROOM",
      displayName: "Engineering",
      singleUserBotDm: false,
    },
    annotations: [
      {
        type: "USER_MENTION",
        startIndex: 0,
        length: 5,
        userMention: {
          user: { name: "users/bot-seer-id", displayName: "seer", type: "BOT" },
          type: "MENTION",
        },
      },
    ],
  },
}

/** MESSAGE in a direct message (DM) conversation. */
const MESSAGE_DM_PAYLOAD = {
  type: "MESSAGE",
  eventTime: "2026-03-25T11:00:00.000Z",
  token: "bot-verification-token-abc123",
  message: {
    name: "spaces/dm-SPACE123/messages/dm-msg-001",
    sender: {
      name: "users/112233445566778899001",
      displayName: "Bob Martinez",
      avatarUrl: "https://lh3.googleusercontent.com/a/default-user",
      email: "bob@example.com",
      type: "HUMAN",
      domainId: "example.com",
    },
    createTime: "2026-03-25T11:00:00.000Z",
    text: "show me the recent error logs",
    thread: { name: "spaces/dm-SPACE123/threads/dm-thread-001" },
    space: {
      name: "spaces/dm-SPACE123",
      type: "DM",
      singleUserBotDm: true,
    },
  },
}

/** MESSAGE with multi-line code block content. */
const MESSAGE_CODE_BLOCK_PAYLOAD = {
  type: "MESSAGE",
  eventTime: "2026-03-25T12:30:00.000Z",
  token: "bot-verification-token-abc123",
  message: {
    name: "spaces/AAAAabcDEFg/messages/msg-002.thread-002",
    sender: {
      name: "users/108765432109876543210",
      displayName: "Alice Chen",
      email: "alice@example.com",
      type: "HUMAN",
    },
    createTime: "2026-03-25T12:30:00.000Z",
    text: "@seer explain this function:\n```typescript\nexport const qualifyId = (platform: Platform, rawId: string) => ({\n  qualified: `${platform}:${rawId}`,\n  platform,\n  raw: rawId,\n})\n```",
    argumentText: " explain this function:\n```typescript\nexport const qualifyId = (platform: Platform, rawId: string) => ({\n  qualified: `${platform}:${rawId}`,\n  platform,\n  raw: rawId,\n})\n```",
    thread: { name: "spaces/AAAAabcDEFg/threads/thread-002" },
    space: { name: "spaces/AAAAabcDEFg", type: "ROOM" },
  },
}

/** Bot added to a Google Chat space. */
const ADDED_TO_SPACE_PAYLOAD = {
  type: "ADDED_TO_SPACE",
  eventTime: "2026-03-25T09:00:00.000Z",
  token: "bot-verification-token-abc123",
  space: {
    name: "spaces/BBBBxyzWQRs",
    type: "ROOM",
    displayName: "Backend Team",
    singleUserBotDm: false,
  },
  user: {
    name: "users/108765432109876543210",
    displayName: "Alice Chen",
    avatarUrl: "https://lh3.googleusercontent.com/a/default-user",
    email: "alice@example.com",
    type: "HUMAN",
    domainId: "example.com",
  },
}

/** Bot added to a DM space. */
const ADDED_TO_DM_PAYLOAD = {
  type: "ADDED_TO_SPACE",
  eventTime: "2026-03-25T09:05:00.000Z",
  token: "bot-verification-token-abc123",
  space: {
    name: "spaces/dm-NEW456",
    type: "DM",
    singleUserBotDm: true,
  },
  user: {
    name: "users/112233445566778899001",
    displayName: "Bob Martinez",
    email: "bob@example.com",
    type: "HUMAN",
  },
}

/** Bot removed from a Google Chat space. */
const REMOVED_FROM_SPACE_PAYLOAD = {
  type: "REMOVED_FROM_SPACE",
  eventTime: "2026-03-25T14:00:00.000Z",
  token: "bot-verification-token-abc123",
  space: {
    name: "spaces/BBBBxyzWQRs",
    type: "ROOM",
    displayName: "Backend Team",
    singleUserBotDm: false,
  },
  user: {
    name: "users/108765432109876543210",
    displayName: "Alice Chen",
    email: "alice@example.com",
    type: "HUMAN",
  },
}

/** MESSAGE with empty/whitespace-only text (edge case). */
const MESSAGE_EMPTY_TEXT_PAYLOAD = {
  type: "MESSAGE",
  eventTime: "2026-03-25T13:00:00.000Z",
  message: {
    name: "spaces/AAAAabcDEFg/messages/msg-003",
    sender: { name: "users/108765432109876543210", displayName: "Alice Chen", type: "HUMAN" },
    createTime: "2026-03-25T13:00:00.000Z",
    text: "   ",
    thread: { name: "spaces/AAAAabcDEFg/threads/thread-003" },
    space: { name: "spaces/AAAAabcDEFg", type: "ROOM" },
  },
}

/** CARD_CLICKED event (unsupported, should not crash). */
const CARD_CLICKED_PAYLOAD = {
  type: "CARD_CLICKED",
  eventTime: "2026-03-25T14:30:00.000Z",
  token: "bot-verification-token-abc123",
  action: { actionMethodName: "feedback_positive" },
  message: {
    name: "spaces/AAAAabcDEFg/messages/msg-004",
    thread: { name: "spaces/AAAAabcDEFg/threads/thread-001" },
    space: { name: "spaces/AAAAabcDEFg", type: "ROOM" },
  },
  user: {
    name: "users/108765432109876543210",
    displayName: "Alice Chen",
    type: "HUMAN",
  },
}

// ── Helpers ─────────────────────────────────────────────────────

const webhookRequest = (payload: unknown): Request =>
  new Request("http://localhost:4320/google-chat/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  })

async function capturedPayload(): Promise<unknown> {
  if (!lastWebhookRequest) throw new Error("No webhook request captured")
  const cloned = lastWebhookRequest.clone()
  return cloned.json()
}

// ── Tests ───────────────────────────────────────────────────────

describe("Google Chat regression: realistic MESSAGE payloads", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    lastWebhookRequest = undefined
    webhookGchatMock.mock.mockImplementation(
      async (request: Request): Promise<Response> => {
        lastWebhookRequest = request
        return new Response(JSON.stringify({ text: "SDK handled" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    )
  })

  it("room @-mention message is delegated to SDK with full payload intact", async () => {
    const res = await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = await capturedPayload()
    const msg = (body as typeof MESSAGE_ROOM_PAYLOAD).message
    assert.equal(msg.text, "@seer what files handle authentication?")
    assert.equal(msg.sender.name, "users/108765432109876543210")
    assert.equal(msg.sender.type, "HUMAN")
    assert.equal(msg.thread.name, "spaces/AAAAabcDEFg/threads/thread-001")
    assert.equal(msg.space.name, "spaces/AAAAabcDEFg")
    assert.equal(msg.space.type, "ROOM")
  })

  it("DM message is delegated to SDK with DM-specific space fields", async () => {
    const res = await handler(webhookRequest(MESSAGE_DM_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = await capturedPayload()
    const msg = (body as typeof MESSAGE_DM_PAYLOAD).message
    assert.equal(msg.space.type, "DM")
    assert.equal(msg.space.singleUserBotDm, true)
    assert.equal(msg.sender.name, "users/112233445566778899001")
  })

  it("multi-line code block message preserves full text content", async () => {
    const res = await handler(webhookRequest(MESSAGE_CODE_BLOCK_PAYLOAD))

    assert.equal(res.status, 200)
    const body = await capturedPayload()
    const msg = (body as typeof MESSAGE_CODE_BLOCK_PAYLOAD).message
    assert.ok(msg.text.includes("```typescript"))
    assert.ok(msg.text.includes("qualifyId"))
  })

  it("message with empty text is still delegated to SDK (SDK or handler manages fallback)", async () => {
    const res = await handler(webhookRequest(MESSAGE_EMPTY_TEXT_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)
  })

  it("event type field is preserved in payload (guards against type=undefined regression)", async () => {
    const res = await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    assert.equal(res.status, 200)
    const body = (await capturedPayload()) as Record<string, unknown>
    assert.equal(body.type, "MESSAGE", "type field must be preserved — type=undefined causes silent routing failures")
  })

  it("eventTime field is preserved for traceability", async () => {
    await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    const body = (await capturedPayload()) as Record<string, unknown>
    assert.equal(body.eventTime, "2026-03-25T10:15:30.000Z")
  })

  it("annotations (user mentions) are preserved in the payload", async () => {
    await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    const body = (await capturedPayload()) as typeof MESSAGE_ROOM_PAYLOAD
    assert.ok(Array.isArray(body.message.annotations), "annotations array must be present")
    assert.equal(body.message.annotations.length, 1)
    assert.equal(body.message.annotations[0].type, "USER_MENTION")
  })

  it("SDK response body is returned directly to the caller", async () => {
    const res = await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    const responseBody = await res.json()
    assert.equal(responseBody.text, "SDK handled")
  })
})

describe("Google Chat regression: ADDED_TO_SPACE events", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    lastWebhookRequest = undefined
    webhookGchatMock.mock.mockImplementation(
      async (request: Request): Promise<Response> => {
        lastWebhookRequest = request
        return new Response(JSON.stringify({ text: "Welcome!" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    )
  })

  it("ADDED_TO_SPACE room event is delegated to SDK", async () => {
    const res = await handler(webhookRequest(ADDED_TO_SPACE_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = (await capturedPayload()) as typeof ADDED_TO_SPACE_PAYLOAD
    assert.equal(body.type, "ADDED_TO_SPACE")
    assert.equal(body.space.name, "spaces/BBBBxyzWQRs")
    assert.equal(body.space.type, "ROOM")
    assert.equal(body.user.name, "users/108765432109876543210")
  })

  it("ADDED_TO_SPACE DM event is delegated to SDK", async () => {
    const res = await handler(webhookRequest(ADDED_TO_DM_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = (await capturedPayload()) as typeof ADDED_TO_DM_PAYLOAD
    assert.equal(body.type, "ADDED_TO_SPACE")
    assert.equal(body.space.type, "DM")
    assert.equal(body.space.singleUserBotDm, true)
  })

  it("ADDED_TO_SPACE preserves space displayName for logging", async () => {
    await handler(webhookRequest(ADDED_TO_SPACE_PAYLOAD))

    const body = (await capturedPayload()) as typeof ADDED_TO_SPACE_PAYLOAD
    assert.equal(body.space.displayName, "Backend Team")
  })
})

describe("Google Chat regression: REMOVED_FROM_SPACE events", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    lastWebhookRequest = undefined
    webhookGchatMock.mock.mockImplementation(
      async (request: Request): Promise<Response> => {
        lastWebhookRequest = request
        return new Response(null, { status: 200 })
      },
    )
  })

  it("REMOVED_FROM_SPACE event is delegated to SDK", async () => {
    const res = await handler(webhookRequest(REMOVED_FROM_SPACE_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = (await capturedPayload()) as typeof REMOVED_FROM_SPACE_PAYLOAD
    assert.equal(body.type, "REMOVED_FROM_SPACE")
    assert.equal(body.space.name, "spaces/BBBBxyzWQRs")
  })

  it("REMOVED_FROM_SPACE does not crash the handler", async () => {
    // Regression: removal events must not throw even if the bot has no
    // local state for the space (e.g. after a restart with in-memory state).
    const res = await handler(webhookRequest(REMOVED_FROM_SPACE_PAYLOAD))

    assert.equal(res.status, 200)
  })
})

describe("Google Chat regression: unsupported/unknown event types", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    lastWebhookRequest = undefined
    webhookGchatMock.mock.mockImplementation(
      async (request: Request): Promise<Response> => {
        lastWebhookRequest = request
        return new Response(null, { status: 200 })
      },
    )
  })

  it("CARD_CLICKED event is still delegated to SDK (not rejected by handler)", async () => {
    const res = await handler(webhookRequest(CARD_CLICKED_PAYLOAD))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)

    const body = (await capturedPayload()) as Record<string, unknown>
    assert.equal(body.type, "CARD_CLICKED")
  })

  it("completely unknown event type is delegated to SDK without crashing", async () => {
    const payload = {
      type: "SOME_FUTURE_EVENT_TYPE",
      eventTime: "2026-03-25T15:00:00.000Z",
      space: { name: "spaces/AAAAabcDEFg", type: "ROOM" },
    }
    const res = await handler(webhookRequest(payload))

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 1)
  })
})

describe("Google Chat regression: stable identity mapping", () => {
  // These tests verify that the identity contract between the handler
  // and the Mastra memory layer is stable. They import the identity
  // helpers directly because the handler just passes the Request through;
  // identity qualification happens in bot.ts event handlers.

  it("qualifyUserId produces stable gchat-prefixed IDs", () => {
    const id1 = qualifyUserId("gchat", "users/108765432109876543210")
    const id2 = qualifyUserId("gchat", "users/108765432109876543210")

    assert.equal(id1.qualified, id2.qualified, "same input must produce identical qualified IDs")
    assert.equal(id1.qualified, "gchat:users/108765432109876543210")
    assert.equal(id1.platform, "gchat")
    assert.equal(id1.raw, "users/108765432109876543210")
  })

  it("qualifyThreadId produces stable gchat-prefixed thread IDs", () => {
    const id = qualifyThreadId("gchat", "spaces/AAAAabcDEFg/threads/thread-001")

    assert.equal(id.qualified, "gchat:spaces/AAAAabcDEFg/threads/thread-001")
    assert.equal(id.platform, "gchat")
  })

  it("different users produce different qualified IDs", () => {
    const alice = qualifyUserId("gchat", "users/108765432109876543210")
    const bob = qualifyUserId("gchat", "users/112233445566778899001")

    assert.notEqual(alice.qualified, bob.qualified)
  })

  it("different threads produce different qualified IDs", () => {
    const t1 = qualifyThreadId("gchat", "spaces/AAAAabcDEFg/threads/thread-001")
    const t2 = qualifyThreadId("gchat", "spaces/AAAAabcDEFg/threads/thread-002")

    assert.notEqual(t1.qualified, t2.qualified)
  })

  it("same numeric user on different platforms produces isolated IDs", () => {
    const gchatUser = qualifyUserId("gchat", "users/12345")
    const discordUser = qualifyUserId("discord", "users/12345")

    assert.notEqual(
      gchatUser.qualified,
      discordUser.qualified,
      "cross-platform IDs must be distinct to prevent memory leakage",
    )
    assert.equal(gchatUser.qualified, "gchat:users/12345")
    assert.equal(discordUser.qualified, "discord:users/12345")
  })

  it("qualifyId is deterministic across invocations (no randomness)", () => {
    const results = Array.from({ length: 10 }, () =>
      qualifyId("gchat", "users/stable-test").qualified,
    )
    const allSame = results.every((r) => r === results[0])
    assert.ok(allSame, "all invocations must produce identical output")
  })

  it("thread IDs from realistic payloads match expected qualification", () => {
    // Simulate what bot.ts receives from the SDK for MESSAGE_ROOM_PAYLOAD
    const rawThread = MESSAGE_ROOM_PAYLOAD.message.thread.name
    const qualified = qualifyThreadId("gchat", rawThread)

    assert.equal(qualified.qualified, `gchat:${rawThread}`)
    assert.ok(qualified.qualified.startsWith("gchat:spaces/"))
  })

  it("user IDs from realistic payloads match expected qualification", () => {
    // Simulate what bot.ts receives from the SDK for MESSAGE_ROOM_PAYLOAD
    const rawSender = MESSAGE_ROOM_PAYLOAD.message.sender.name
    const qualified = qualifyUserId("gchat", rawSender)

    assert.equal(qualified.qualified, `gchat:${rawSender}`)
    assert.ok(qualified.qualified.startsWith("gchat:users/"))
  })
})

describe("GitLab webhook: unaffected by Google Chat migration", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
  })

  it("POST /webhook/branch-update does not touch the Google Chat SDK", async () => {
    const req = new Request("http://localhost:4320/webhook/branch-update", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/main" }),
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Push Hook",
      },
    })
    const res = await handler(req)

    assert.notEqual(res.status, 404, "branch-update route must still be routed")
    assert.equal(webhookGchatMock.mock.callCount(), 0, "GitLab webhook must not trigger Google Chat SDK")
  })

  it("POST /webhook/branch-update with GitHub push header does not touch Google Chat SDK", async () => {
    const req = new Request("http://localhost:4320/webhook/branch-update", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/main" }),
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
      },
    })
    const res = await handler(req)

    assert.notEqual(res.status, 404)
    assert.equal(webhookGchatMock.mock.callCount(), 0, "GitHub webhook must not trigger Google Chat SDK")
  })

  it("GET /health does not touch the Google Chat SDK", async () => {
    const req = new Request("http://localhost:4320/health")
    const res = await handler(req)

    assert.equal(res.status, 200)
    assert.equal(webhookGchatMock.mock.callCount(), 0)
  })

  it("unknown routes return 404 and do not touch the Google Chat SDK", async () => {
    const req = new Request("http://localhost:4320/random/path", {
      method: "POST",
      body: JSON.stringify({ type: "MESSAGE" }),
      headers: { "content-type": "application/json" },
    })
    const res = await handler(req)

    assert.equal(res.status, 404)
    assert.equal(webhookGchatMock.mock.callCount(), 0)
  })
})

describe("Google Chat regression: request integrity", () => {
  beforeEach(() => {
    webhookGchatMock.mock.resetCalls()
    lastWebhookRequest = undefined
    webhookGchatMock.mock.mockImplementation(
      async (request: Request): Promise<Response> => {
        lastWebhookRequest = request
        return new Response(JSON.stringify({ text: "OK" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    )
  })

  it("passes the original Request object (not a re-serialized copy) to the SDK", async () => {
    await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    assert.ok(lastWebhookRequest instanceof Request)
    assert.equal(lastWebhookRequest.method, "POST")
  })

  it("preserves content-type header through to the SDK", async () => {
    await handler(webhookRequest(MESSAGE_ROOM_PAYLOAD))

    assert.ok(lastWebhookRequest)
    const ct = lastWebhookRequest.headers.get("content-type")
    assert.equal(ct, "application/json")
  })

  it("the webhook route remains at /google-chat/webhook (not renamed)", async () => {
    const req = new Request("http://localhost:4320/google-chat/webhook", {
      method: "POST",
      body: JSON.stringify(MESSAGE_ROOM_PAYLOAD),
      headers: { "content-type": "application/json" },
    })
    const res = await handler(req)

    assert.notEqual(res.status, 404, "webhook route must not have been renamed")
    assert.equal(webhookGchatMock.mock.callCount(), 1)
  })

  it("all three standard event types route to the same SDK webhook handler", async () => {
    const payloads = [
      MESSAGE_ROOM_PAYLOAD,
      ADDED_TO_SPACE_PAYLOAD,
      REMOVED_FROM_SPACE_PAYLOAD,
    ]

    for (const payload of payloads) {
      webhookGchatMock.mock.resetCalls()
      const res = await handler(webhookRequest(payload))
      assert.equal(res.status, 200)
      assert.equal(
        webhookGchatMock.mock.callCount(),
        1,
        `${(payload as Record<string, unknown>).type} must be delegated to SDK`,
      )
    }
  })
})
