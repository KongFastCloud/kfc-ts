import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { loop } from "../src/loop.js"
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
})
