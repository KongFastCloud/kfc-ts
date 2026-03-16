import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@workspace/universal-memory/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "msg-1" }])),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve([])),
          limit: vi.fn(() => Promise.resolve([{ id: "conv-1", userId: "user-1" }])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),
  },
}))

vi.mock("@workspace/universal-memory/schema", () => ({
  conversations: { id: "conversations.id" },
  messages: {
    id: "messages.id",
    conversationId: "messages.conversation_id",
    role: "messages.role",
    content: "messages.content",
    createdAt: "messages.created_at",
  },
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
}))

const mockToDataStreamResponse = vi.fn(() => new Response("streaming"))

vi.mock("@workspace/mastra/chat", () => ({
  chat: vi.fn(() => ({
    toDataStreamResponse: mockToDataStreamResponse,
  })),
}))

describe("sendMessage server function", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports a callable server function", async () => {
    const { sendMessage } = await import("./chat")
    expect(sendMessage).toBeDefined()
    expect(typeof sendMessage).toBe("function")
  })
})
