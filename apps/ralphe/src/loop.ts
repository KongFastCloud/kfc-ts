import { Console, Effect } from "effect"
import { CheckFailure, FatalError } from "./errors.js"

export type LoopEventType = "attempt_start" | "check_failed" | "success"

export interface LoopEvent {
  readonly type: LoopEventType
  readonly attempt: number
  readonly maxAttempts: number
}

export interface LoopOptions {
  readonly maxAttempts?: number
  readonly onEvent?: (event: LoopEvent) => Effect.Effect<void, never>
}

interface LoopState {
  readonly attempt: number
  readonly feedback: string | undefined
  readonly done: boolean
}

export const loop = <R>(
  fn: (feedback: string | undefined, attempt: number, maxAttempts: number) => Effect.Effect<unknown, CheckFailure | FatalError, R>,
  opts?: LoopOptions,
): Effect.Effect<void, FatalError, R> => {
  const maxAttempts = opts?.maxAttempts ?? 2
  const onEvent = opts?.onEvent

  const emitEvent = (event: LoopEvent): Effect.Effect<void, never> =>
    onEvent ? onEvent(event) : Effect.void

  return Effect.iterate(
    { attempt: 1, feedback: undefined, done: false } as LoopState,
    {
      while: (state) => !state.done,
      body: (state) =>
        Effect.gen(function* () {
          yield* emitEvent({ type: "attempt_start", attempt: state.attempt, maxAttempts })
          yield* Console.log(`\n--- Attempt ${state.attempt}/${maxAttempts} ---`)

          if (state.feedback) {
            yield* Console.log(`Retrying with feedback from previous failure`)
          }

          return yield* fn(state.feedback, state.attempt, maxAttempts).pipe(
            Effect.tap(() => emitEvent({ type: "success", attempt: state.attempt, maxAttempts })),
            Effect.map(() => {
              return { attempt: state.attempt, feedback: undefined, done: true } as LoopState
            }),
            Effect.catchTag("CheckFailure", (err) => {
              if (state.attempt >= maxAttempts) {
                return Effect.fail(
                  new FatalError({
                    command: err.command,
                    message: `Check failed after ${maxAttempts} attempts: ${err.stderr}`,
                  }),
                )
              }
              return Console.log(
                `Check failed: "${err.command}" exited ${err.exitCode}. Will retry.`,
              ).pipe(
                Effect.map(() => ({
                  attempt: state.attempt + 1,
                  feedback: `Command "${err.command}" failed (exit ${err.exitCode}):\n${err.stderr}`,
                  done: false,
                }) as LoopState),
              )
            }),
          )
        }),
    },
  ) as Effect.Effect<void, FatalError, R>
}
