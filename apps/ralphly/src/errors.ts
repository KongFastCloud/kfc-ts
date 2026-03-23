/**
 * ABOUTME: Error types for ralphly CLI.
 */

import { Data } from "effect"

export class FatalError extends Data.TaggedError("FatalError")<{
  readonly command: string
  readonly message: string
}> {}
