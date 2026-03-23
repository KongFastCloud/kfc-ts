# Linear Agent POC

Disposable webhook receiver for exploring Linear agent-session behavior.

## What It Does

- Accepts Linear agent-session webhooks at `POST /linear/webhook`
- Accepts Linear OAuth redirects at `GET /oauth/callback`
- Stores raw payloads as JSONL under `data/events.jsonl`
- Stores the latest OAuth token response under `data/oauth-latest.json`
- Exposes `GET /health`
- Exposes `GET /events` for quick inspection
- Optionally emits a tiny `thought` activity back to Linear on `created` events

## Environment

- `PORT`
  - Optional. Defaults to `4310`.
- `LINEAR_API_KEY`
  - Optional. Personal API key mode. If set, the app will try to send a simple activity back to Linear using `Authorization: <API_KEY>`.
- `LINEAR_ACCESS_TOKEN`
  - Optional. OAuth mode. If set, the app will try to send a simple activity back to Linear using `Authorization: Bearer <ACCESS_TOKEN>`.
- `LINEAR_AUTH_HEADER`
  - Optional. Exact `Authorization` header value to use when calling Linear. Overrides `LINEAR_API_KEY` and `LINEAR_ACCESS_TOKEN`.
- `LINEAR_GRAPHQL_URL`
  - Optional. Defaults to `https://api.linear.app/graphql`.
- `LINEAR_CLIENT_ID`
  - Required to complete the OAuth callback exchange.
- `LINEAR_CLIENT_SECRET`
  - Required to complete the OAuth callback exchange.
- `LINEAR_OAUTH_REDIRECT_URI`
  - Required to complete the OAuth callback exchange. Must exactly match the callback URL configured in Linear.
- `LINEAR_OAUTH_TOKEN_URL`
  - Optional. Defaults to `https://api.linear.app/oauth/token`.

## Run

```bash
pnpm --filter linear-agent-poc dev
```

or

```bash
pnpm --filter linear-agent-poc start
```

## Notes

- This app is intentionally temporary and should be deleted after the Linear behavior has been understood.
- Signature verification is not implemented yet; this app is for controlled experimentation only.
- Without Linear auth env vars, the app still works in log-only mode and will capture incoming webhook payloads.
- To complete the Linear OAuth install flow, configure the callback env vars and point Linear's callback URL at `/oauth/callback`.
