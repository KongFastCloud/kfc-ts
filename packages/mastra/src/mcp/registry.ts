/**
 * MCP server registry.
 *
 * Provides a thin coordination layer that:
 *  1. Validates required environment variables before connecting.
 *  2. Builds an MCPClient from one or more MCPServerRegistration entries.
 *  3. Exposes the merged tool map so callers (e.g. agent factories) can
 *     pass it straight to a Mastra Agent.
 *
 * The registry itself is stateless — it produces MCPClient instances but
 * does not hold global singletons, keeping tests straightforward.
 */

import { MCPClient } from "@mastra/mcp";
import type { MCPServerRegistration, EnvRequirement } from "./types.ts";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class MCPConfigError extends Error {
  override readonly name = "MCPConfigError";
  readonly server: string;
  readonly missing: readonly string[];
  constructor(server: string, missing: readonly string[]) {
    super(
      `MCP server "${server}" is missing required env vars: ${missing.join(", ")}`,
    );
    this.server = server;
    this.missing = missing;
  }
}

/**
 * Validate that every required env var for a registration is present.
 *
 * @throws MCPConfigError when one or more required variables are missing.
 */
export function validateEnv(
  registration: MCPServerRegistration,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = registration.env
    .filter((e: EnvRequirement) => e.required && !env[e.name])
    .map((e: EnvRequirement) => e.name);

  if (missing.length > 0) {
    throw new MCPConfigError(registration.name, missing);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface MCPRegistryOptions {
  /**
   * Override the environment record used for validation and definition
   * construction. Defaults to `process.env`.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Global timeout in ms forwarded to MCPClient. */
  readonly timeout?: number;
}

/**
 * Build an MCPClient from a set of server registrations.
 *
 * Each registration is validated and then converted into the
 * `MastraMCPServerDefinition` expected by `@mastra/mcp`.
 *
 * ```ts
 * import { buildMCPClient } from "@workspace/mastra/mcp";
 * import { glitchtip } from "@workspace/mastra/mcp";
 *
 * const mcp = buildMCPClient([glitchtip]);
 * const tools = await mcp.getTools();
 * ```
 */
export function buildMCPClient(
  registrations: readonly MCPServerRegistration[],
  options: MCPRegistryOptions = {},
): MCPClient {
  const env = options.env ?? process.env;

  // Validate all registrations up-front so we fail fast.
  for (const reg of registrations) {
    validateEnv(reg, env);
  }

  const servers: Record<
    string,
    ReturnType<MCPServerRegistration["createDefinition"]>
  > = {};

  for (const reg of registrations) {
    servers[reg.name] = reg.createDefinition(env);
  }

  return new MCPClient({
    servers,
    ...(options.timeout != null ? { timeout: options.timeout } : {}),
  });
}
