/**
 * ABOUTME: Tests for the shell command execution step.
 * Verifies success on exit 0, CheckFailure on non-zero exit,
 * and stdout/stderr capture.
 */

import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { cmd } from "../src/cmd.js"
import { CheckFailure } from "../src/errors.js"

const workspace = fs.realpathSync(os.tmpdir())

describe("cmd", () => {
  test("succeeds on exit 0", async () => {
    const result = await Effect.runPromise(cmd("echo hello", workspace))
    expect(result.stdout.trim()).toBe("hello")
    expect(result.exitCode).toBe(0)
  })

  test("fails with CheckFailure on non-zero exit", async () => {
    const result = await Effect.runPromiseExit(cmd("exit 1", workspace))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error
      expect(err._tag).toBe("CheckFailure")
    }
  })

  test("captures stderr on failure", async () => {
    const result = await Effect.runPromiseExit(cmd("echo 'error output' >&2 && exit 1", workspace))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as CheckFailure
      expect(err.stderr).toContain("error output")
      expect(err.exitCode).toBe(1)
    }
  })

  test("captures stdout on success", async () => {
    const result = await Effect.runPromise(cmd("echo 'success output'", workspace))
    expect(result.stdout.trim()).toBe("success output")
  })

  test("executes in the specified workspace directory", async () => {
    const result = await Effect.runPromise(cmd("pwd", workspace))
    expect(result.stdout.trim()).toBe(workspace)
  })
})
