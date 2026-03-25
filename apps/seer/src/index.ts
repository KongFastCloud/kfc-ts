/**
 * Seer — codebase exploration chat service.
 *
 * HTTP server that exposes platform-specific webhook endpoints
 * for chat-based codebase Q&A. Google Chat is the first adapter;
 * additional platforms can be added by registering new routes in
 * handler.ts.
 *
 * Runs in the same Coder instance as the source code.
 *
 * Usage:
 *   pnpm dev          # watch mode
 *   pnpm start        # production
 *   PORT=4320 pnpm start
 */

import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

import { Effect, Fiber, Logger } from "effect"

// ── Load .env files BEFORE any app modules that read process.env ──
// Static imports are hoisted above module-level code, so app modules
// that construct env-sensitive objects (e.g. the Google Chat adapter)
// must be dynamically imported after dotenv has populated process.env.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")

dotenv.config({ path: path.join(appRoot, ".env.local"), quiet: true })
dotenv.config({ path: path.join(appRoot, ".env"), quiet: true })

// ── App modules (env is now available) ──
const { handler } = await import("./handler.ts")
const { log } = await import("./log.ts")
const { reindexWorkerLoop } = await import("./reindex-worker.ts")
const { runStartupTasks } = await import("./startup/index.ts")

const port = Number(process.env.PORT ?? "4320")

const server = http.createServer(async (req, res) => {
  const protocol = req.headers.host?.includes("localhost") ? "http" : "https"
  const requestUrl = `${protocol}://${req.headers.host ?? `localhost:${port}`}${req.url ?? "/"}`

  const request = new Request(requestUrl, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as BodyInit),
    // @ts-expect-error duplex is required for streaming request bodies in Node
    duplex: "half",
  })

  const response = await handler(request)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
})

// ── Best-effort startup tasks (sync + reindex) ──
// Attempted before the server begins serving traffic.
// Failures are logged; the server starts regardless.
await runStartupTasks()

// ── Background reindex worker ──
// Long-lived daemon fiber that processes webhook-triggered reindex requests.
// Runs independently of the HTTP server; chat stays available while it works.
const workerLogLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)
const workerFiber = Effect.runFork(
  reindexWorkerLoop.pipe(Effect.provide(workerLogLayer)),
)

server.listen(port, () => {
  log(`listening on http://localhost:${port}`)
  log("routes:")
  log("  GET  /health                  — health check")
  log("  POST /google-chat/webhook     — Google Chat ingress")
  log("  POST /webhook/branch-update   — Git provider branch-update webhook")
})
