/**
 * ABOUTME: Tagged error types for the blueprints execution runner.
 * CheckFailure is recoverable (triggers retry with feedback).
 * FatalError is unrecoverable (terminates execution immediately).
 */

import { Data } from "effect"

export class CheckFailure extends Data.TaggedError("CheckFailure")<{
  readonly command: string
  readonly stderr: string
  readonly exitCode: number
}> {}

export class FatalError extends Data.TaggedError("FatalError")<{
  readonly command: string
  readonly message: string
}> {}
