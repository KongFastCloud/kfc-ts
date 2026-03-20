import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { loop, type LoopEvent } from "../src/loop.js"
import { CheckFailure, FatalError } from "../src/errors.js"

describe("loop", () => {
  test("succeeds on first attempt", async () => {
    let calls = 0
    await Effect.runPromise(
      loop(() => {
        calls++
        return Effect.succeed("ok")
      }),
    )
    expect(calls).toBe(1)
  })

  test("retries on CheckFailure and passes feedback", async () => {
    let calls = 0
    let receivedFeedback: string | undefined
    await Effect.runPromise(
      loop(
        (feedback) => {
          calls++
          receivedFeedback = feedback
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({
                command: "test",
                stderr: "type error",
                exitCode: 1,
              }),
            )
          }
          return Effect.succeed("ok")
        },
        { maxAttempts: 2 },
      ),
    )
    expect(calls).toBe(2)
    expect(receivedFeedback).toContain("type error")
  })

  test("converts CheckFailure to FatalError after max attempts", async () => {
    const result = await Effect.runPromiseExit(
      loop(
        () =>
          Effect.fail(
            new CheckFailure({
              command: "lint",
              stderr: "lint error",
              exitCode: 1,
            }),
          ),
        { maxAttempts: 2 },
      ),
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as FatalError
      expect(err._tag).toBe("FatalError")
      expect(err.message).toContain("2 attempts")
    }
  })

  test("propagates FatalError immediately", async () => {
    let calls = 0
    const result = await Effect.runPromiseExit(
      loop(
        () => {
          calls++
          return Effect.fail(
            new FatalError({ command: "agent", message: "auth failed" }),
          )
        },
        { maxAttempts: 3 },
      ),
    )
    expect(calls).toBe(1)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as FatalError
      expect(err._tag).toBe("FatalError")
      expect(err.message).toBe("auth failed")
    }
  })

  test("passes attempt and maxAttempts to fn", async () => {
    const seen: Array<{ attempt: number; maxAttempts: number }> = []
    await Effect.runPromise(
      loop(
        (_feedback, attempt, maxAttempts) => {
          seen.push({ attempt, maxAttempts })
          if (seen.length === 1) {
            return Effect.fail(
              new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 }),
            )
          }
          return Effect.succeed("ok")
        },
        { maxAttempts: 3 },
      ),
    )
    expect(seen).toEqual([
      { attempt: 1, maxAttempts: 3 },
      { attempt: 2, maxAttempts: 3 },
    ])
  })

  test("onEvent fires attempt_start and success events", async () => {
    const events: LoopEvent[] = []
    await Effect.runPromise(
      loop(
        () => Effect.succeed("ok"),
        {
          maxAttempts: 2,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    expect(events).toEqual([
      { type: "attempt_start", attempt: 1, maxAttempts: 2 },
      { type: "success", attempt: 1, maxAttempts: 2 },
    ])
  })

  test("onEvent fires attempt_start for each retry", async () => {
    const events: LoopEvent[] = []
    let calls = 0
    await Effect.runPromise(
      loop(
        () => {
          calls++
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({ command: "test", stderr: "err", exitCode: 1 }),
            )
          }
          return Effect.succeed("ok")
        },
        {
          maxAttempts: 3,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    expect(events).toEqual([
      { type: "attempt_start", attempt: 1, maxAttempts: 3 },
      { type: "attempt_start", attempt: 2, maxAttempts: 3 },
      { type: "success", attempt: 2, maxAttempts: 3 },
    ])
  })
})
