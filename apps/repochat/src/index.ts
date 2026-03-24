/**
 * Repochat — codebase exploration chat service.
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

import { handler } from "./handler.ts"
import { log } from "./log.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")

dotenv.config({ path: path.join(appRoot, ".env.local"), quiet: true })
dotenv.config({ path: path.join(appRoot, ".env"), quiet: true })

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

server.listen(port, () => {
  log(`listening on http://localhost:${port}`)
  log("routes:")
  log("  GET  /health                  — health check")
  log("  POST /google-chat/webhook     — Google Chat ingress")
})
