/**
 * ABOUTME: Tests for the low-level command execution primitive.
 * Owns the contract that cmd() succeeds with stdout on exit 0, returns a
 * CheckFailure with exit code and captured stderr on non-zero exit. This is
 * the foundational boundary used by checks, git, and other shell-out paths.
 */

import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { cmd } from "../src/cmd.js"
import { CheckFailure } from "../src/errors.js"

describe("cmd", () => {
  test("succeeds with echo", async () => {
    const result = await Effect.runPromise(cmd("echo hello"))
    expect(result.stdout.trim()).toBe("hello")
    expect(result.exitCode).toBe(0)
  })

  test("returns CheckFailure on non-zero exit", async () => {
    const result = await Effect.runPromiseExit(cmd("exit 1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = result.cause
      // Extract the CheckFailure from the cause
      if (error._tag === "Fail") {
        expect(error.error).toBeInstanceOf(CheckFailure)
        expect(error.error._tag).toBe("CheckFailure")
        expect((error.error as CheckFailure).exitCode).toBe(1)
      }
    }
  })

  test("captures stderr", async () => {
    const result = await Effect.runPromiseExit(cmd("echo err >&2 && exit 2"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as CheckFailure
      expect(err.stderr.trim()).toBe("err")
      expect(err.exitCode).toBe(2)
    }
  })
})
