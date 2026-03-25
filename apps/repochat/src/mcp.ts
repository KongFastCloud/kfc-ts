/**
 * MCP client factories for repochat.
 *
 * Builds MCP clients using the reusable server registrations from
 * @workspace/mastra/mcp. Each factory returns null when required
 * environment variables are missing — graceful degradation, not a
 * hard failure.
 *
 * Clients are built once at startup via the Effect Layer in runtime.ts.
 * Tools are fetched asynchronously and bound to the agent at that point.
 */

import { buildMCPClient, glitchtip, codemogger, MCPConfigError } from "@workspace/mastra/mcp"

/**
 * Attempt to build a GlitchTip MCP client from environment configuration.
 *
 * Returns null when required env vars (GLITCHTIP_TOKEN, GLITCHTIP_ORGANIZATION)
 * are missing — the caller should treat this as "GlitchTip not configured"
 * and proceed without GlitchTip tools.
 *
 * Re-throws any error that is NOT a missing-env validation error, since
 * those indicate a real problem (e.g. malformed registration).
 */
export function createGlitchTipClient(): ReturnType<typeof buildMCPClient> | null {
  try {
    return buildMCPClient([glitchtip])
  } catch (err) {
    if (err instanceof MCPConfigError) {
      return null
    }
    throw err
  }
}

/**
 * Attempt to build a codemogger MCP client from environment configuration.
 *
 * Codemogger has no required env vars (CODEMOGGER_DB_PATH is optional),
 * so this always returns a client. The client may still fail at tool-fetch
 * time if codemogger is not installed — that is handled in runtime.ts.
 */
export function createCodemoggerClient(): ReturnType<typeof buildMCPClient> {
  return buildMCPClient([codemogger])
}
