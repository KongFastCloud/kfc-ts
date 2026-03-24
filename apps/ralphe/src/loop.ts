import { Effect } from "effect"
import { CheckFailure, FatalError } from "./errors.js"
import { withSpan } from "./telemetry.js"

export type LoopEventType = "attempt_start" | "check_failed" | "success"

export interface LoopEvent {
  readonly type: LoopEventType
  readonly attempt: number
  readonly maxAttempts: number
  readonly feedback?: string | undefined
}

export interface LoopOptions {
  readonly maxAttempts?: number
  readonly onEvent?: (event: LoopEvent) => Effect.Effect<void, never>
  /** Extra attributes forwarded to each `loop.attempt` OTel span (e.g. engine, issue.id). */
  readonly spanAttributes?: Record<string, string | number | boolean>
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

  const extraAttrs = opts?.spanAttributes ?? {}

  return Effect.iterate(
    { attempt: 1, feedback: undefined, done: false } as LoopState,
    {
      while: (state) => !state.done,
      body: (state) => {
        const attemptBody = Effect.gen(function* () {
          yield* emitEvent({ type: "attempt_start", attempt: state.attempt, maxAttempts })
          yield* Effect.logInfo(`Attempt ${state.attempt}/${maxAttempts}`)

          if (state.feedback) {
            yield* Effect.logInfo("Retrying with feedback from previous failure.")
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
              const feedback = `Command "${err.command}" failed (exit ${err.exitCode}):\n${err.stderr}`
              return emitEvent({
                type: "check_failed",
                attempt: state.attempt,
                maxAttempts,
                feedback,
              }).pipe(
                Effect.andThen(Effect.logWarning(
                  `Check failed: "${err.command}" exited ${err.exitCode}. Will retry.`,
                )),
                Effect.map(() => ({
                  attempt: state.attempt + 1,
                  feedback,
                  done: false,
                }) as LoopState),
              )
            }),
          )
        }).pipe(Effect.annotateLogs({ attempt: state.attempt, maxAttempts }))

        return withSpan("loop.attempt", {
          "loop.attempt": state.attempt,
          "loop.max_attempts": maxAttempts,
          ...extraAttrs,
        }, attemptBody)
      },
    },
  ) as Effect.Effect<void, FatalError, R>
}
