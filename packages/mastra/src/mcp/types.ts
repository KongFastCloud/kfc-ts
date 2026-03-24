/**
 * Reusable MCP server registration types.
 *
 * These types define the configuration contract for registering external
 * MCP servers in the Mastra layer. Each server definition combines the
 * transport config needed by @mastra/mcp with metadata and environment
 * validation so that misconfiguration fails fast and clearly.
 */

import type { MastraMCPServerDefinition } from "@mastra/mcp";

// ---------------------------------------------------------------------------
// Environment contract
// ---------------------------------------------------------------------------

/** Describes a single environment variable requirement. */
export interface EnvRequirement {
  /** Variable name (e.g. "GLITCHTIP_TOKEN"). */
  readonly name: string;
  /** When true the variable must be present at registration time. */
  readonly required: boolean;
  /** Human-readable purpose shown in validation errors. */
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Server registration
// ---------------------------------------------------------------------------

/**
 * A registered MCP server definition combining transport config with
 * metadata used for validation and documentation.
 */
export interface MCPServerRegistration {
  /** Logical name used as the key in the MCPClient servers map. */
  readonly name: string;
  /** Human-readable description of what this server provides. */
  readonly description: string;
  /** The env vars this server depends on. */
  readonly env: readonly EnvRequirement[];
  /**
   * Factory that produces the @mastra/mcp transport definition.
   *
   * Receives a resolved env record so the caller does not need to
   * interact with `process.env` directly — useful for testing.
   */
  readonly createDefinition: (
    env: Readonly<Record<string, string | undefined>>,
  ) => MastraMCPServerDefinition;
}
