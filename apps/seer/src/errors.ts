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
