/**
 * ABOUTME: Tests for error type tagging.
 * Verifies CheckFailure and FatalError have correct _tag values
 * for Effect's catchTag to work properly.
 */

import { describe, test, expect } from "bun:test"
import { CheckFailure, FatalError } from "../src/errors.js"

describe("CheckFailure", () => {
  test("has correct tag", () => {
    const err = new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 })
    expect(err._tag).toBe("CheckFailure")
    expect(err.command).toBe("test")
    expect(err.stderr).toBe("fail")
    expect(err.exitCode).toBe(1)
  })
})

describe("FatalError", () => {
  test("has correct tag", () => {
    const err = new FatalError({ command: "agent", message: "auth failed" })
    expect(err._tag).toBe("FatalError")
    expect(err.command).toBe("agent")
    expect(err.message).toBe("auth failed")
  })
})
