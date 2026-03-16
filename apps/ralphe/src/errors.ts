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
