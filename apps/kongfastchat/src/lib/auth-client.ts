import { createAuthClient } from "@neondatabase/neon-js/auth"
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react"

const authUrl = import.meta.env.VITE_NEON_AUTH_URL

if (!authUrl) {
  throw new Error("Missing VITE_NEON_AUTH_URL")
}

export const authClient = createAuthClient(
  authUrl,
  { adapter: BetterAuthReactAdapter() },
)
