/**
 * Codemogger MCP server registration.
 *
 * Defines the configuration contract for connecting to a local codemogger
 * instance via its built-in MCP stdio server (`codemogger mcp`). The server
 * provides semantic and keyword code search over an indexed codebase.
 *
 * Environment variables:
 *   CODEMOGGER_DB_PATH — (optional) Path to the codemogger index database.
 *                         Defaults to `<project>/.codemogger/index.db`.
 */

import type { MCPServerRegistration } from "./types.ts";

/**
 * Reusable server registration for codemogger.
 *
 * Import and pass to `buildMCPClient` to wire up the integration:
 *
 * ```ts
 * import { buildMCPClient, codemogger } from "@workspace/mastra/mcp";
 *
 * const mcp = buildMCPClient([codemogger]);
 * const tools = await mcp.getTools();
 * ```
 */
export const codemogger: MCPServerRegistration = {
  name: "codemogger",
  description:
    "Semantic and keyword code search over an indexed codebase via codemogger.",

  env: [
    {
      name: "CODEMOGGER_DB_PATH",
      required: false,
      description:
        "Path to the codemogger index database. Defaults to <project>/.codemogger/index.db.",
    },
  ],

  createDefinition: (env) => ({
    command: "npx",
    args: [
      "-y",
      "codemogger",
      "mcp",
      ...(env.CODEMOGGER_DB_PATH ? ["--db", env.CODEMOGGER_DB_PATH] : []),
    ],
  }),
};
