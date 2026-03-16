import {
  boolean,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Reference to neon_auth schema for user FK
const neonAuth = pgSchema("neon_auth")

export const neonAuthUsers = neonAuth.table("user", {
  id: uuid("id").primaryKey(),
})

// Enums
export const roleEnum = pgEnum("role", ["user", "assistant", "system"])

// Tables
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => neonAuthUsers.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  pinned: boolean("pinned").default(false).notNull(),
  tags: jsonb("tags").$type<Array<string>>().default([]),
})

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => neonAuthUsers.id),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})
