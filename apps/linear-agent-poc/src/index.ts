import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

interface StoredEvent {
  readonly receivedAt: string
  readonly headers: Record<string, string>
  readonly payload: JsonValue
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const dataDir = path.join(appRoot, "data")
const eventsFile = path.join(dataDir, "events.jsonl")

const port = Number(process.env.PORT ?? "4310")
const linearApiKey = process.env.LINEAR_API_KEY
const linearAccessToken = process.env.LINEAR_ACCESS_TOKEN
const linearAuthHeader = process.env.LINEAR_AUTH_HEADER
const linearGraphqlUrl = process.env.LINEAR_GRAPHQL_URL ?? "https://api.linear.app/graphql"

fs.mkdirSync(dataDir, { recursive: true })

const resolvedLinearAuthorization =
  linearAuthHeader
  ?? (linearAccessToken ? `Bearer ${linearAccessToken}` : undefined)
  ?? linearApiKey

const json = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  })

const appendEvent = (event: StoredEvent): void => {
  fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n")
}

const readRecentEvents = (limit = 20): StoredEvent[] => {
  if (!fs.existsSync(eventsFile)) return []

  const lines = fs
    .readFileSync(eventsFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)

  return lines
    .slice(-limit)
    .map((line) => JSON.parse(line) as StoredEvent)
    .reverse()
}

const getHeaderMap = (request: Request): Record<string, string> =>
  Object.fromEntries(request.headers.entries())

const getEventAction = (payload: JsonValue): string | undefined => {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "action" in payload) {
    const action = payload.action
    return typeof action === "string" ? action : undefined
  }
  return undefined
}

const getAgentSessionId = (payload: JsonValue): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined

  const agentSession = "agentSession" in payload ? payload.agentSession : undefined
  if (!agentSession || typeof agentSession !== "object" || Array.isArray(agentSession)) return undefined

  const id = "id" in agentSession ? agentSession.id : undefined
  return typeof id === "string" ? id : undefined
}

const sendThoughtActivity = async (agentSessionId: string): Promise<void> => {
  if (!resolvedLinearAuthorization) return

  const query = `
    mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) {
        success
      }
    }
  `

  const variables = {
    input: {
      agentSessionId,
      content: {
        type: "thought",
        body: "POC webhook received. Logging this session for behavior inspection.",
      },
    },
  }

  const response = await fetch(linearGraphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: resolvedLinearAuthorization,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Linear API request failed (${response.status}): ${body}`)
  }
}

const handleWebhook = async (request: Request): Promise<Response> => {
  let payload: JsonValue

  try {
    payload = (await request.json()) as JsonValue
  } catch {
    return json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  appendEvent({
    receivedAt: new Date().toISOString(),
    headers: getHeaderMap(request),
    payload,
  })

  const action = getEventAction(payload)
  const agentSessionId = getAgentSessionId(payload)

  if (action === "created" && agentSessionId && resolvedLinearAuthorization) {
    try {
      await sendThoughtActivity(agentSessionId)
    } catch (error) {
      console.error("Failed to send thought activity", error)
    }
  }

  return json({
    ok: true,
    stored: true,
    action,
    agentSessionId,
  })
}

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "linear-agent-poc" })
  }

  if (request.method === "GET" && url.pathname === "/events") {
    const limit = Number(url.searchParams.get("limit") ?? "20")
    return json({ events: readRecentEvents(limit) })
  }

  if (request.method === "POST" && url.pathname === "/linear/webhook") {
    return handleWebhook(request)
  }

  return json({ error: "Not found" }, { status: 404 })
}

const server = http.createServer(async (req, res) => {
  const protocol = req.headers.host?.includes("localhost") ? "http" : "https"
  const requestUrl = `${protocol}://${req.headers.host ?? `localhost:${port}`}${req.url ?? "/"}`

  const request = new Request(requestUrl, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
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
  console.log(`linear-agent-poc listening on http://localhost:${port}`)
  console.log(
    resolvedLinearAuthorization
      ? "linear-agent-poc mode: webhook logging + Linear thought activity"
      : "linear-agent-poc mode: webhook logging only (no Linear auth configured)",
  )
})
