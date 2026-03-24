/**
 * GlitchTip MCP server registration.
 *
 * Defines the configuration contract for connecting to a GlitchTip instance
 * via the `mcp-glitchtip` stdio server. Authentication uses a personal API
 * token (`GLITCHTIP_TOKEN`) rather than session cookies, and the target
 * organization is set via `GLITCHTIP_ORGANIZATION`.
 *
 * Environment variables:
 *   GLITCHTIP_TOKEN         — (required) API token for GlitchTip auth.
 *   GLITCHTIP_ORGANIZATION  — (required) GlitchTip organization slug.
 *   GLITCHTIP_BASE_URL      — (optional) Base URL for self-hosted instances.
 */

import type { MCPServerRegistration } from "./types.ts";

const DEFAULT_BASE_URL = "https://app.glitchtip.com";

/**
 * Reusable server registration for GlitchTip.
 *
 * Import and pass to `buildMCPClient` to wire up the integration:
 *
 * ```ts
 * import { buildMCPClient, glitchtip } from "@workspace/mastra/mcp";
 *
 * const mcp = buildMCPClient([glitchtip]);
 * const tools = await mcp.getTools();
 * ```
 */
export const glitchtip: MCPServerRegistration = {
  name: "glitchtip",
  description:
    "Read-only access to GlitchTip issues and events via mcp-glitchtip.",

  env: [
    {
      name: "GLITCHTIP_TOKEN",
      required: true,
      description: "API token for GlitchTip authentication.",
    },
    {
      name: "GLITCHTIP_ORGANIZATION",
      required: true,
      description: "GlitchTip organization slug.",
    },
    {
      name: "GLITCHTIP_BASE_URL",
      required: false,
      description: `Base URL for the GlitchTip instance (default: ${DEFAULT_BASE_URL}).`,
    },
  ],

  createDefinition: (env) => ({
    command: "npx",
    args: ["-y", "mcp-glitchtip"],
    env: {
      GLITCHTIP_TOKEN: env.GLITCHTIP_TOKEN!,
      GLITCHTIP_ORGANIZATION: env.GLITCHTIP_ORGANIZATION!,
      ...(env.GLITCHTIP_BASE_URL
        ? { GLITCHTIP_BASE_URL: env.GLITCHTIP_BASE_URL }
        : { GLITCHTIP_BASE_URL: DEFAULT_BASE_URL }),
    },
  }),
};
