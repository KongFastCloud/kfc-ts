/**
 * ABOUTME: Generic retry loop with feedback propagation.
 * Wraps any Effect-based function in a retry loop. On CheckFailure, captures
 * stderr as feedback string and passes it to the next attempt. After max
 * attempts are exhausted, escalates to FatalError. Emits lifecycle events
 * for external observers.
 */

import { Effect } from "effect"
import { CheckFailure, FatalError } from "./errors.js"

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
          yield* Effect.logInfo(`Attempt ${state.attempt}/${maxAttempts}`)

          if (state.feedback) {
            yield* Effect.logDebug(`Retrying with feedback from previous failure`)
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
        }).pipe(Effect.annotateLogs({ attempt: state.attempt, maxAttempts })),
    },
  ) as Effect.Effect<void, FatalError, R>
}
