/**
 * ABOUTME: Pure-data per-invocation request for the direct run path.
 * Contains execution inputs only — no resolved collaborators, service instances,
 * or persisted config references. Built at the CLI boundary from CLI flags,
 * task input, and code defaults.
 */

import type { GitMode } from "./config.js"

/**
 * Pure-data representation of a single direct-run invocation.
 * Every field is a plain value; no Effect services, layers, or callbacks.
 */
export interface RunRequest {
  /** The task prompt to send to the agent. */
  readonly task: string
  /** Which engine to use for this run. */
  readonly engine: "claude" | "codex"
  /** Shell commands to run as post-agent verification checks. */
  readonly checks: readonly string[]
  /** Maximum retry attempts before declaring failure. */
  readonly maxAttempts: number
  /** Git operation mode after successful execution. */
  readonly gitMode: GitMode
  /** Verification report mode. */
  readonly reportMode: "browser" | "basic" | "none"
}
