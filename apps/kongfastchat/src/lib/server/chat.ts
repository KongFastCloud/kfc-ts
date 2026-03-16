import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db } from "@workspace/db/client"
import { conversations, messages } from "@workspace/db/schema"
import { eq } from "drizzle-orm"
import { chat } from "@workspace/mastra/chat"

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      conversationId: z.string().uuid(),
      userId: z.string().uuid(),
      content: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    // Verify the conversation exists and belongs to the user
    const rows = await db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1)

    if (rows.length === 0 || rows[0].userId !== data.userId) {
      throw new Error("Conversation not found")
    }

    // Persist user message
    await db.insert(messages).values({
      conversationId: data.conversationId,
      role: "user",
      content: { text: data.content },
      source: "web",
    })

    // Build message history for context
    const history = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, data.conversationId))
      .orderBy(messages.createdAt)

    const coreMessages = history.map((m) => ({
      role: m.role,
      content: (m.content as { text: string }).text,
    }))

    // Stream LLM response and persist on completion
    const result = chat({
      messages: coreMessages,
      onFinish: async ({ text }) => {
        await db.insert(messages).values({
          conversationId: data.conversationId,
          role: "assistant",
          content: { text },
          source: "web",
        })

        // Update conversation timestamp
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, data.conversationId))
      },
    })

    return result.toDataStreamResponse()
  })
