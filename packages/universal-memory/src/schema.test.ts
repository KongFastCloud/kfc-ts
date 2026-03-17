import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq, sql } from "drizzle-orm"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import "dotenv/config"
import * as schema from "./schema"
import { apiKeys, conversations, messages } from "./schema"

const databaseUrl = process.env.DATABASE_URL
const describeIfDatabase = databaseUrl ? describe : describe.skip
const createTestDb = (url: string) => drizzle({ client: neon(url), schema })

type Database = ReturnType<typeof createTestDb>

let db: Database
let rawSql: ReturnType<typeof neon>
let testUserId: string

beforeAll(async () => {
  if (!databaseUrl) {
    return
  }

  rawSql = neon(databaseUrl)
  db = createTestDb(databaseUrl)

  // Create a test user in neon_auth.user (requires name, email, emailVerified)
  testUserId = crypto.randomUUID()
  await rawSql`INSERT INTO neon_auth."user" (id, name, email, "emailVerified") VALUES (${testUserId}, 'Test User', 'test@example.com', true)`
})

afterAll(async () => {
  if (!databaseUrl) {
    return
  }

  // Clean up in reverse FK order
  await db.delete(messages)
  await db.delete(apiKeys)
  await db.delete(conversations)
  await rawSql`DELETE FROM neon_auth."user" WHERE id = ${testUserId}`
})

describeIfDatabase("conversations", () => {
  it("creates and reads a conversation", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        userId: testUserId,
        title: "Test conversation",
        tags: ["test", "integration"],
      })
      .returning()

    expect(conv.id).toBeDefined()
    expect(conv.title).toBe("Test conversation")
    expect(conv.pinned).toBe(false)
    expect(conv.tags).toEqual(["test", "integration"])

    const [found] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conv.id))

    expect(found.title).toBe("Test conversation")
  })

  it("updates a conversation", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, title: "Original" })
      .returning()

    const [updated] = await db
      .update(conversations)
      .set({ title: "Updated", pinned: true })
      .where(eq(conversations.id, conv.id))
      .returning()

    expect(updated.title).toBe("Updated")
    expect(updated.pinned).toBe(true)
  })

  it("deletes a conversation", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, title: "To delete" })
      .returning()

    await db.delete(conversations).where(eq(conversations.id, conv.id))

    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conv.id))

    expect(result).toHaveLength(0)
  })

  it("queries by JSONB tags", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        userId: testUserId,
        title: "Tagged",
        tags: ["important", "work"],
      })
      .returning()

    const result = await db
      .select()
      .from(conversations)
      .where(
        sql`${conversations.tags} @> ${JSON.stringify(["important"])}::jsonb`
      )

    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some((c) => c.id === conv.id)).toBe(true)
  })
})

describeIfDatabase("messages", () => {
  it("creates messages linked to a conversation", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, title: "With messages" })
      .returning()

    const [msg] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        role: "user",
        content: { text: "Hello world" },
        source: "web",
      })
      .returning()

    expect(msg.role).toBe("user")
    expect(msg.content).toEqual({ text: "Hello world" })
    expect(msg.source).toBe("web")
  })

  it("cascades delete when conversation is deleted", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, title: "Cascade test" })
      .returning()

    await db.insert(messages).values([
      {
        conversationId: conv.id,
        role: "user",
        content: { text: "msg 1" },
      },
      {
        conversationId: conv.id,
        role: "assistant",
        content: { text: "msg 2" },
      },
    ])

    // Delete conversation — messages should cascade
    await db.delete(conversations).where(eq(conversations.id, conv.id))

    const remaining = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))

    expect(remaining).toHaveLength(0)
  })

  it("rejects messages with invalid conversation_id", async () => {
    await expect(
      db.insert(messages).values({
        conversationId: crypto.randomUUID(),
        role: "user",
        content: { text: "orphan" },
      })
    ).rejects.toThrow()
  })

  it("queries JSONB content fields", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, title: "JSONB query" })
      .returning()

    await db.insert(messages).values({
      conversationId: conv.id,
      role: "assistant",
      content: { text: "special-marker-123", model: "gpt-4" },
    })

    const result = await db
      .select()
      .from(messages)
      .where(sql`${messages.content} ->> 'text' = 'special-marker-123'`)

    expect(result).toHaveLength(1)
    expect(result[0].content.model).toBe("gpt-4")
  })
})

describeIfDatabase("api_keys", () => {
  it("creates and reads an API key", async () => {
    const [key] = await db
      .insert(apiKeys)
      .values({
        userId: testUserId,
        keyHash: "sha256:abc123",
        name: "Test Key",
      })
      .returning()

    expect(key.id).toBeDefined()
    expect(key.keyHash).toBe("sha256:abc123")
    expect(key.revokedAt).toBeNull()
  })

  it("revokes an API key", async () => {
    const [key] = await db
      .insert(apiKeys)
      .values({
        userId: testUserId,
        keyHash: "sha256:torevoke",
        name: "Revocable Key",
      })
      .returning()

    const [revoked] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, key.id))
      .returning()

    expect(revoked.revokedAt).not.toBeNull()
  })

  it("rejects API key with invalid user_id", async () => {
    await expect(
      db.insert(apiKeys).values({
        userId: crypto.randomUUID(),
        keyHash: "sha256:orphan",
        name: "Bad Key",
      })
    ).rejects.toThrow()
  })
})
