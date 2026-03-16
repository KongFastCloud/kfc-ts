import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockOrderBy = vi.fn()
const mockLimit = vi.fn()
const mockValues = vi.fn()
const mockReturning = vi.fn()
const mockSet = vi.fn()

vi.mock("@workspace/db/client", () => ({
  db: {
    insert: (...args: Array<unknown>) => {
      mockInsert(...args)
      return { values: (...a: Array<unknown>) => { mockValues(...a); return { returning: (...r: Array<unknown>) => { mockReturning(...r); return Promise.resolve([{ id: "conv-123" }]) } } } }
    },
    select: (...args: Array<unknown>) => {
      mockSelect(...args)
      return {
        from: (...a: Array<unknown>) => {
          mockFrom(...a)
          return {
            where: (...w: Array<unknown>) => {
              mockWhere(...w)
              return {
                orderBy: (...o: Array<unknown>) => { mockOrderBy(...o); return Promise.resolve([]) },
                limit: (...l: Array<unknown>) => { mockLimit(...l); return Promise.resolve([]) },
              }
            },
          }
        },
      }
    },
    update: (...args: Array<unknown>) => {
      mockUpdate(...args)
      return { set: (...s: Array<unknown>) => { mockSet(...s); return { where: vi.fn().mockResolvedValue(undefined) } } }
    },
  },
}))

vi.mock("@workspace/db/schema", () => ({
  conversations: { id: "conversations.id", userId: "conversations.user_id" },
  messages: {
    id: "messages.id",
    conversationId: "messages.conversation_id",
    role: "messages.role",
    content: "messages.content",
    createdAt: "messages.created_at",
  },
}))

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  and: vi.fn((...args: Array<unknown>) => ({ op: "and", args })),
  asc: vi.fn((a) => ({ op: "asc", a })),
  desc: vi.fn((a) => ({ op: "desc", a })),
}))

describe("conversations server functions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createConversation", () => {
    it("exports a callable server function", async () => {
      const { createConversation } = await import("./conversations")
      expect(createConversation).toBeDefined()
      expect(typeof createConversation).toBe("function")
    })
  })

  describe("getMessages", () => {
    it("exports a callable server function", async () => {
      const { getMessages } = await import("./conversations")
      expect(getMessages).toBeDefined()
      expect(typeof getMessages).toBe("function")
    })
  })

  describe("getConversation", () => {
    it("exports a callable server function", async () => {
      const { getConversation } = await import("./conversations")
      expect(getConversation).toBeDefined()
      expect(typeof getConversation).toBe("function")
    })
  })

  describe("getConversations", () => {
    it("exports a callable server function", async () => {
      const { getConversations } = await import("./conversations")
      expect(getConversations).toBeDefined()
      expect(typeof getConversations).toBe("function")
    })
  })

  describe("renameConversation", () => {
    it("exports a callable server function", async () => {
      const { renameConversation } = await import("./conversations")
      expect(renameConversation).toBeDefined()
      expect(typeof renameConversation).toBe("function")
    })
  })

  describe("deleteConversation", () => {
    it("exports a callable server function", async () => {
      const { deleteConversation } = await import("./conversations")
      expect(deleteConversation).toBeDefined()
      expect(typeof deleteConversation).toBe("function")
    })
  })
})
