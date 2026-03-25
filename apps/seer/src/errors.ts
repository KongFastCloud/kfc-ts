/**
 * Typed error hierarchy for the seer Effect boundary.
 *
 * Each error is a tagged discriminated union member so Effect's
 * `catchTag` can route specific failures without instanceof checks.
 */

import { Data } from "effect"

/** Model call or agent execution failed (network, rate limit, gateway). */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Incoming webhook payload was malformed or missing required fields. */
export class PayloadError extends Data.TaggedError("PayloadError")<{
  readonly message: string
}> {}

/**
 * Required configuration is missing or invalid.
 *
 * Thrown at startup when environment variables needed for a core
 * subsystem are not set. The message should include actionable
 * guidance so operators can fix the problem without reading source.
 */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError"

  constructor(message: string) {
    super(message)
  }
}
