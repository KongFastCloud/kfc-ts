/**
 * Request router.
 *
 * Maps incoming HTTP requests to the appropriate adapter or
 * health endpoint. The routing boundary is explicit so that
 * additional platform routes (e.g. /discord/webhook) can be
 * added later without restructuring the app.
 */

import { handleGoogleChatWebhook } from "./adapters/google-chat.ts"
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
    return json({ ok: true, service: "repochat" })
  }

  // ── Google Chat webhook ──
  if (request.method === "POST" && url.pathname === "/google-chat/webhook") {
    const body = await request.text()
    const result = await handleGoogleChatWebhook(body)

    if (result.body === null) {
      return new Response(null, { status: result.status })
    }

    return json(result.body, { status: result.status })
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
