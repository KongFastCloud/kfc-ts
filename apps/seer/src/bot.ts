/**
 * Chat SDK instance for seer.
 *
 * Configures the Vercel Chat SDK (`chat`) with the Google Chat adapter
 * and an in-memory state adapter. Event handlers bridge incoming
 * messages into the Effect-based chat layer for Mastra agent execution.
 *
 * The SDK handles payload parsing, event dispatch, thread subscription,
 * and per-thread serialization — seer only provides the message→reply logic.
 * User identity is qualified via identity.ts helpers for consistent
 * platform-scoped Mastra memory isolation.
 *
 * Webhook routing:
 *   handler.ts delegates POST /google-chat/webhook → bot.webhooks.gchat
 *
 * Identity mapping:
 *   - threadId  → thread.id (SDK-qualified, e.g. "gchat:space:thread")
 *   - userId    → "gchat:<author.userId>" (platform-qualified for Mastra memory)
 */

import { Chat } from "chat"
import { createGoogleChatAdapter } from "@chat-adapter/gchat"
import { createMemoryState } from "@chat-adapter/state-memory"
import { Exit } from "effect"
import type { Thread, Message } from "chat"

import { generateReply } from "./chat.ts"
import { runtime } from "./runtime.ts"
import { qualifyUserId } from "./identity.ts"
import { validateGoogleChatAuth } from "./config.ts"
import { ConfigurationError } from "./errors.ts"
import { log } from "./log.ts"

const PLATFORM = "gchat" as const

// ── Google Chat auth validation ─────────────────────────────────
// Validate before the adapter tries to initialise so operators get
// an actionable app-level message instead of a raw SDK exception.

validateGoogleChatAuth()

// ── Chat SDK instance ───────────────────────────────────────────

let adapter: ReturnType<typeof createGoogleChatAdapter>
try {
  adapter = createGoogleChatAdapter()
} catch (error: unknown) {
  // If the SDK still throws (e.g. credentials JSON is malformed),
  // wrap it with guidance so the failure stays actionable.
  if (error instanceof ConfigurationError) throw error
  throw new ConfigurationError(
    [
      "Google Chat adapter failed to initialise.",
      "",
      `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      "",
      "Check that your Google Chat auth environment variables are valid.",
      "See apps/seer/README.md § \"Google Chat Setup\" and .env.example for details.",
    ].join("\n"),
  )
}

export const bot = new Chat({
  userName: "seer",
  adapters: {
    gchat: adapter,
  },
  state: createMemoryState(),
  logger: "warn",
})

// ── Shared message handler ──────────────────────────────────────

/**
 * Process an incoming message through the Effect/Mastra pipeline.
 *
 * Extracts thread and user identity from the SDK-normalised objects,
 * runs the reply generator, and posts the result back to the thread.
 */
async function handleIncomingMessage(
  thread: Thread,
  message: Message,
): Promise<void> {
  const text = message.text?.trim()
  if (!text) {
    await thread.post("I didn't catch that — could you try again?")
    return
  }

  const threadId = thread.id
  const userId = qualifyUserId(PLATFORM, message.author.userId).qualified

  log("google-chat: message", {
    threadId,
    userId,
    textLength: text.length,
  })

  const program = generateReply({ threadId, userId, text })
  const exit = await runtime.runPromiseExit(program)

  if (Exit.isSuccess(exit)) {
    log("google-chat: reply generated", {
      threadId,
      replyLength: exit.value.text.length,
    })
    await thread.post(exit.value.text)
    return
  }

  // ── Failure path — log cause, return friendly message ──
  const failure = Exit.isFailure(exit) ? exit.cause : undefined
  log("google-chat: reply generation failed", {
    threadId,
    error: failure ? String(failure) : "unknown",
  })

  await thread.post(
    "Sorry, I ran into an error processing your request. Please try again.",
  )
}

// ── Event handlers ──────────────────────────────────────────────

/**
 * New @-mention in a thread the bot is not yet subscribed to.
 *
 * Subscribe so that follow-up messages in the same thread also
 * reach the bot (routed to onSubscribedMessage).
 */
bot.onNewMention(async (thread, message) => {
  await thread.subscribe()
  await handleIncomingMessage(thread, message)
})

/**
 * Message in a thread the bot is already subscribed to.
 */
bot.onSubscribedMessage(async (thread, message) => {
  await handleIncomingMessage(thread, message)
})
