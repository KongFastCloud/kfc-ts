/**
 * GlitchTip MCP client for repochat.
 *
 * Builds the MCP client using the reusable GlitchTip registration from
 * @workspace/mastra/mcp. If the required environment variables are not
 * configured, client creation returns null so the agent can still
 * operate without GlitchTip — graceful degradation, not a hard failure.
 *
 * The client is built once at startup via the Effect Layer in runtime.ts.
 * Tools are fetched asynchronously and bound to the agent at that point.
 */

import { buildMCPClient, glitchtip, MCPConfigError } from "@workspace/mastra/mcp"

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
