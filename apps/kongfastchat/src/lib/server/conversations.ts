import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db } from "@workspace/db/client"
import { conversations, messages } from "@workspace/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"

export const createConversation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid(), title: z.string().nullable() }))
  .handler(async ({ data }) => {
    try {
      const [row] = await db
        .insert(conversations)
        .values({ userId: data.userId, title: data.title })
        .returning({ id: conversations.id })
      return row
    } catch (err) {
      console.error("createConversation DB error:", err)
      throw err
    }
  })

export const getMessages = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ conversationId: z.string().uuid(), userId: z.string().uuid() }),
  )
  .handler(async ({ data }) => {
    // Verify the conversation belongs to the user
    const convRows = await db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1)

    if (convRows.length === 0 || convRows[0].userId !== data.userId) {
      throw new Error("Conversation not found")
    }

    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, data.conversationId))
      .orderBy(asc(messages.createdAt))
    // Cast to serializable type for TanStack Start
    return JSON.parse(JSON.stringify(rows)) as Array<{
      id: string
      role: "user" | "assistant" | "system"
      content: { text: string }
      createdAt: string
    }>
  })

export const getConversation = createServerFn({ method: "GET" })
  .inputValidator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1)
    return rows[0] ?? null
  })

export const getConversations = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, data.userId))
      .orderBy(desc(conversations.updatedAt))
    return JSON.parse(JSON.stringify(rows)) as Array<{
      id: string
      title: string | null
      createdAt: string
      updatedAt: string
    }>
  })

export const renameConversation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      conversationId: z.string().uuid(),
      userId: z.string().uuid(),
      title: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const result = await db
      .update(conversations)
      .set({ title: data.title })
      .where(
        and(
          eq(conversations.id, data.conversationId),
          eq(conversations.userId, data.userId),
        ),
      )
      .returning({ id: conversations.id })
    if (result.length === 0) {
      throw new Error("Conversation not found")
    }
    return result[0]
  })

export const deleteConversation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      conversationId: z.string().uuid(),
      userId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, data.conversationId),
          eq(conversations.userId, data.userId),
        ),
      )
      .returning({ id: conversations.id })
    if (result.length === 0) {
      throw new Error("Conversation not found")
    }
    return result[0]
  })
