import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

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

interface OAuthTokenResponse {
  readonly access_token: string
  readonly token_type?: string
  readonly expires_in?: number
  readonly scope?: string | string[]
  readonly refresh_token?: string
  readonly [key: string]: JsonValue | undefined
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const dataDir = path.join(appRoot, "data")
const eventsFile = path.join(dataDir, "events.jsonl")
const oauthFile = path.join(dataDir, "oauth-latest.json")

dotenv.config({ path: path.join(appRoot, ".env.local"), quiet: true })
dotenv.config({ path: path.join(appRoot, ".env"), quiet: true })

const port = Number(process.env.PORT ?? "4310")
const linearApiKey = process.env.LINEAR_API_KEY
const linearAccessToken = process.env.LINEAR_ACCESS_TOKEN
const linearAuthHeader = process.env.LINEAR_AUTH_HEADER
const linearGraphqlUrl = process.env.LINEAR_GRAPHQL_URL ?? "https://api.linear.app/graphql"
const linearClientId = process.env.LINEAR_CLIENT_ID
const linearClientSecret = process.env.LINEAR_CLIENT_SECRET
const linearOauthRedirectUri = process.env.LINEAR_OAUTH_REDIRECT_URI
const linearOauthTokenUrl = process.env.LINEAR_OAUTH_TOKEN_URL ?? "https://api.linear.app/oauth/token"

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

const writeLatestOauth = (value: JsonValue): void => {
  fs.writeFileSync(oauthFile, JSON.stringify(value, null, 2) + "\n")
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

const html = (body: string, status = 200): Response =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>linear-agent-poc</title></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  )

const handleOauthCallback = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) {
    return html(`<h1>Linear OAuth failed</h1><p>${error}</p>`, 400)
  }

  if (!code) {
    return html("<h1>Missing OAuth code</h1>", 400)
  }

  if (!linearClientId || !linearClientSecret || !linearOauthRedirectUri) {
    return html(
      "<h1>Missing OAuth configuration</h1><p>Set LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, and LINEAR_OAUTH_REDIRECT_URI.</p>",
      500,
    )
  }

  const form = new URLSearchParams({
    code,
    redirect_uri: linearOauthRedirectUri,
    client_id: linearClientId,
    client_secret: linearClientSecret,
    grant_type: "authorization_code",
  })

  const response = await fetch(linearOauthTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  })

  const rawBody = await response.text()

  if (!response.ok) {
    writeLatestOauth({
      receivedAt: new Date().toISOString(),
      ok: false,
      status: response.status,
      state,
      body: rawBody,
    })
    return html("<h1>OAuth exchange failed</h1><p>Check the saved oauth file for details.</p>", 500)
  }

  let tokenResponse: OAuthTokenResponse
  try {
    tokenResponse = JSON.parse(rawBody) as OAuthTokenResponse
  } catch {
    writeLatestOauth({
      receivedAt: new Date().toISOString(),
      ok: false,
      status: response.status,
      state,
      body: rawBody,
    })
    return html("<h1>OAuth exchange returned invalid JSON</h1>", 500)
  }

  writeLatestOauth({
    receivedAt: new Date().toISOString(),
    ok: true,
    state,
    tokenType: tokenResponse.token_type ?? null,
    expiresIn: tokenResponse.expires_in ?? null,
    scope: tokenResponse.scope ?? null,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token ?? null,
    raw: tokenResponse as JsonValue,
  })

  return html("<h1>Linear OAuth success</h1><p>Token response saved locally for the POC.</p>")
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

  if (request.method === "GET" && url.pathname === "/oauth/callback") {
    return handleOauthCallback(request)
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
  console.log(
    linearClientId && linearClientSecret && linearOauthRedirectUri
      ? "linear-agent-poc OAuth callback: enabled"
      : "linear-agent-poc OAuth callback: disabled (missing LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET / LINEAR_OAUTH_REDIRECT_URI)",
  )
})
