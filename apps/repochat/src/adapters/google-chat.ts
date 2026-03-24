/**
 * Google Chat webhook adapter.
 *
 * Handles incoming Google Chat webhook POST payloads, extracts
 * platform-qualified thread and user identifiers, and routes the
 * message through the Effect-based chat bridge. Returns a synchronous
 * JSON response that Google Chat renders as the bot reply.
 *
 * Reference: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
 *
 * Supports:
 *   - MESSAGE events (user sends a message)
 *   - ADDED_TO_SPACE events (bot added to space — responds with greeting)
 *   - REMOVED_FROM_SPACE events (acknowledged silently)
 *
 * Non-goals for this slice:
 *   - Card-based responses
 *   - Interactive cards / dialogs
 *   - Async follow-up via Google Chat API
 */

import { Exit } from "effect"
import { qualifyThreadId, qualifyUserId } from "../identity.ts"
import { acquireThreadLock } from "../state.ts"
import { generateReply } from "../chat.ts"
import { runtime } from "../runtime.ts"
import { log } from "../log.ts"

// ── Google Chat Webhook Payload Types ────────────────────────────

interface GoogleChatUser {
  readonly name: string // "users/123456"
  readonly displayName?: string
  readonly type: "HUMAN" | "BOT"
}

interface GoogleChatThread {
  readonly name: string // "spaces/SPACE_ID/threads/THREAD_ID"
}

interface GoogleChatSpace {
  readonly name: string // "spaces/SPACE_ID"
  readonly type: "ROOM" | "DM" | "SPACE"
}

interface GoogleChatMessage {
  readonly name: string // "spaces/SPACE_ID/messages/MSG_ID"
  readonly sender: GoogleChatUser
  readonly createTime: string
  readonly text?: string
  readonly argumentText?: string
  readonly thread: GoogleChatThread
  readonly space: GoogleChatSpace
}

interface GoogleChatEvent {
  readonly type: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED"
  readonly eventTime: string
  readonly message?: GoogleChatMessage
  readonly user?: GoogleChatUser
  readonly space?: GoogleChatSpace
}

// ── Response helpers ─────────────────────────────────────────────

interface GoogleChatResponse {
  readonly text?: string
  readonly thread?: { readonly name: string }
}

const textReply = (text: string, threadName?: string): GoogleChatResponse => ({
  text,
  ...(threadName ? { thread: { name: threadName } } : {}),
})

// ── Adapter ──────────────────────────────────────────────────────

const PLATFORM = "gchat" as const

/**
 * Parse a raw webhook body and produce a Google Chat JSON response.
 *
 * Returns `null` for events that should be acknowledged with an
 * empty 200 (e.g. REMOVED_FROM_SPACE).
 */
export const handleGoogleChatWebhook = async (
  body: string,
): Promise<{ status: number; body: GoogleChatResponse | null }> => {
  let event: GoogleChatEvent

  try {
    event = JSON.parse(body) as GoogleChatEvent
  } catch {
    log("google-chat: invalid JSON payload")
    return { status: 400, body: { text: "Invalid JSON payload" } }
  }

  log("google-chat: event received", { type: event.type })

  // ── REMOVED_FROM_SPACE ──
  if (event.type === "REMOVED_FROM_SPACE") {
    log("google-chat: removed from space", { space: event.space?.name })
    return { status: 200, body: null }
  }

  // ── ADDED_TO_SPACE ──
  if (event.type === "ADDED_TO_SPACE") {
    const spaceName = event.space?.name ?? "unknown"
    log("google-chat: added to space", { space: spaceName })
    return {
      status: 200,
      body: textReply(
        "👋 Hi! I'm Repochat — a codebase exploration assistant. Ask me anything about the repo.",
      ),
    }
  }

  // ── MESSAGE ──
  if (event.type === "MESSAGE") {
    return handleMessage(event)
  }

  // Unknown event type — acknowledge without action
  log("google-chat: unhandled event type", { type: event.type })
  return { status: 200, body: null }
}

const handleMessage = async (
  event: GoogleChatEvent,
): Promise<{ status: number; body: GoogleChatResponse }> => {
  const message = event.message
  if (!message) {
    log("google-chat: MESSAGE event missing message field")
    return { status: 400, body: textReply("Missing message payload") }
  }

  // Extract the user's text. `argumentText` strips the @mention prefix.
  const userText = message.argumentText?.trim() || message.text?.trim()
  if (!userText) {
    return { status: 200, body: textReply("I didn't catch that — could you try again?") }
  }

  // ── Build platform-qualified identifiers ──
  const threadId = qualifyThreadId(PLATFORM, message.thread.name)
  const userId = qualifyUserId(PLATFORM, message.sender.name)

  log("google-chat: message", {
    threadId: threadId.qualified,
    userId: userId.qualified,
    textLength: userText.length,
    space: message.space.name,
  })

  // ── Acquire per-thread lock ──
  const release = await acquireThreadLock(threadId.qualified)

  try {
    // Build the Effect program and run it through the managed runtime
    const program = generateReply({
      threadId: threadId.qualified,
      userId: userId.qualified,
      text: userText,
    })

    const exit = await runtime.runPromiseExit(program)

    if (Exit.isSuccess(exit)) {
      log("google-chat: reply generated", {
        threadId: threadId.qualified,
        replyLength: exit.value.text.length,
      })

      return {
        status: 200,
        body: textReply(exit.value.text, message.thread.name),
      }
    }

    // ── Failure path — extract cause for logging ──
    const failure = Exit.isFailure(exit) ? exit.cause : undefined
    log("google-chat: reply generation failed", {
      threadId: threadId.qualified,
      error: failure ? String(failure) : "unknown",
    })

    return {
      status: 200,
      body: textReply("Sorry, I ran into an error processing your request. Please try again."),
    }
  } finally {
    release()
  }
}
