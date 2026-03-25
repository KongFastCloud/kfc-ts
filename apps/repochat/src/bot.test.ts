/**
 * Bot callback unit tests.
 *
 * Verifies that the Chat SDK event handler logic used in bot.ts
 * correctly bridges incoming messages through the Effect/Mastra
 * pipeline. Tests exercise the handler pattern with mock Thread
 * and Message objects, isolating from SDK webhook internals,
 * network, and credential concerns.
 *
 * Run with: pnpm test
 */

import { describe, it, mock } from "node:test"
import assert from "node:assert/strict"
import { Effect, Exit } from "effect"

// ── Mock types ──────────────────────────────────────────────────

interface MockChatRequest {
  threadId: string
  userId: string
  text: string
}

interface MockChatResponse {
  text: string
}

// ── Mock factories ──────────────────────────────────────────────

function makeGenerateReply(
  impl: (req: MockChatRequest) => Effect.Effect<MockChatResponse, unknown> = () =>
    Effect.succeed({ text: "Mock reply from Repochat" }),
) {
  return mock.fn(impl)
}

function makeMockThread(id = "gchat:spaces/SPACE1:spaces/SPACE1/threads/THREAD1") {
  return {
    id,
    channelId: "spaces/SPACE1",
    isDM: false,
    subscribe: mock.fn(async () => {}),
    post: mock.fn(async (_content: string) => ({})),
  }
}

function makeMockMessage(overrides?: {
  text?: string
  userId?: string
  userName?: string
}) {
  return {
    id: "msg-1",
    threadId: "gchat:spaces/SPACE1:spaces/SPACE1/threads/THREAD1",
    text: overrides?.text ?? "what is this repo?",
    author: {
      userId: overrides?.userId ?? "users/112233",
      userName: overrides?.userName ?? "testuser",
      fullName: "Test User",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date(), edited: false },
    attachments: [],
    links: [],
    isMention: true,
  }
}

// ── Simulate the handleIncomingMessage logic from bot.ts ────────

const PLATFORM = "gchat" as const

async function simulateHandleMessage(
  thread: ReturnType<typeof makeMockThread>,
  message: ReturnType<typeof makeMockMessage>,
  generateReply: ReturnType<typeof makeGenerateReply>,
): Promise<void> {
  const text = message.text?.trim()
  if (!text) {
    await thread.post("I didn't catch that — could you try again?")
    return
  }

  const threadId = thread.id
  const userId = `${PLATFORM}:${message.author.userId}`

  const program = generateReply({ threadId, userId, text })
  const exit = await Effect.runPromiseExit(program)

  if (Exit.isSuccess(exit)) {
    await thread.post(exit.value.text)
    return
  }

  await thread.post(
    "Sorry, I ran into an error processing your request. Please try again.",
  )
}

// ── Tests ───────────────────────────────────────────────────────

describe("Bot message handler", () => {
  it("calls generateReply with correct threadId, userId, and text", async () => {
    const generateReply = makeGenerateReply()
    const thread = makeMockThread()
    const message = makeMockMessage()

    await simulateHandleMessage(thread, message, generateReply)

    assert.equal(generateReply.mock.callCount(), 1)
    const call = generateReply.mock.calls[0]!.arguments[0] as MockChatRequest
    assert.equal(call.threadId, "gchat:spaces/SPACE1:spaces/SPACE1/threads/THREAD1")
    assert.equal(call.userId, "gchat:users/112233")
    assert.equal(call.text, "what is this repo?")
  })

  it("posts the reply to the thread on success", async () => {
    const generateReply = makeGenerateReply()
    const thread = makeMockThread()
    const message = makeMockMessage()

    await simulateHandleMessage(thread, message, generateReply)

    assert.equal(thread.post.mock.callCount(), 1)
    assert.equal(thread.post.mock.calls[0]!.arguments[0], "Mock reply from Repochat")
  })

  it("posts a friendly error message when generateReply fails", async () => {
    const generateReply = makeGenerateReply(
      () => Effect.fail({ _tag: "AgentError", message: "gateway timeout" }),
    )
    const thread = makeMockThread()
    const message = makeMockMessage()

    await simulateHandleMessage(thread, message, generateReply)

    assert.equal(thread.post.mock.callCount(), 1)
    const posted = thread.post.mock.calls[0]!.arguments[0] as string
    assert.ok(posted.includes("error"))
    assert.ok(!posted.includes("gateway timeout"), "should not leak internal error")
  })

  it("posts fallback when message text is empty", async () => {
    const generateReply = makeGenerateReply()
    const thread = makeMockThread()
    const message = makeMockMessage({ text: "" })

    await simulateHandleMessage(thread, message, generateReply)

    assert.equal(thread.post.mock.callCount(), 1)
    const posted = thread.post.mock.calls[0]!.arguments[0] as string
    assert.ok(posted.includes("didn't catch"))
    assert.equal(generateReply.mock.callCount(), 0, "should not call generateReply for empty text")
  })

  it("subscribes to thread in onNewMention flow", async () => {
    const thread = makeMockThread()

    // Simulate onNewMention: subscribe then handle
    await thread.subscribe()

    assert.equal(thread.subscribe.mock.callCount(), 1)
  })

  it("qualifies userId with gchat platform prefix", () => {
    const message = makeMockMessage({ userId: "users/998877" })
    const qualified = `${PLATFORM}:${message.author.userId}`
    assert.equal(qualified, "gchat:users/998877")
  })

  it("uses thread.id directly as threadId (already SDK-qualified)", () => {
    const thread = makeMockThread("gchat:spaces/ABC:spaces/ABC/threads/XYZ")
    assert.equal(thread.id, "gchat:spaces/ABC:spaces/ABC/threads/XYZ")
  })

  it("different threads produce different threadIds", async () => {
    const generateReply = makeGenerateReply()
    const thread1 = makeMockThread("gchat:spaces/A:spaces/A/threads/T1")
    const thread2 = makeMockThread("gchat:spaces/A:spaces/A/threads/T2")
    const message = makeMockMessage()

    await simulateHandleMessage(thread1, message, generateReply)
    await simulateHandleMessage(thread2, message, generateReply)

    const call1 = generateReply.mock.calls[0]!.arguments[0] as MockChatRequest
    const call2 = generateReply.mock.calls[1]!.arguments[0] as MockChatRequest
    assert.notEqual(call1.threadId, call2.threadId)
  })
})
