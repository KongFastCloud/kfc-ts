/**
 * Request router.
 *
 * Maps incoming HTTP requests to the appropriate adapter or
 * health endpoint. The routing boundary is explicit so that
 * additional platform routes (e.g. /discord/webhook) can be
 * added later without restructuring the app.
 *
 * Google Chat ingress is handled by the Chat SDK via bot.webhooks.gchat.
 * The SDK handles payload parsing, event dispatch, thread management,
 * and per-thread locking internally.
 */

import { bot } from "./bot.ts"
import { handleBranchUpdateWebhook } from "./adapters/webhook.ts"
import { log } from "./log.ts"

const json = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  })

export const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)

  // ── Health ──
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "seer" })
  }

  // ── Google Chat webhook (SDK-backed) ──
  if (request.method === "POST" && url.pathname === "/google-chat/webhook") {
    return bot.webhooks.gchat(request)
  }

  // ── Git provider webhook (tracked-branch updates) ──
  if (request.method === "POST" && url.pathname === "/webhook/branch-update") {
    const body = await request.text()
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    const result = await handleBranchUpdateWebhook(body, headers)
    return json(result.body, { status: result.status })
  }

  // ── 404 ──
  log("not found", { method: request.method, path: url.pathname })
  return json({ error: "Not found" }, { status: 404 })
}
