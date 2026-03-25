import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { AgentError, ConfigurationError, PayloadError } from "./errors.ts"

describe("AgentError", () => {
  it("creates a tagged error with message", () => {
    const err = new AgentError({ message: "gateway timeout" })
    assert.equal(err._tag, "AgentError")
    assert.equal(err.message, "gateway timeout")
  })

  it("preserves the original cause", () => {
    const cause = new Error("network failure")
    const err = new AgentError({ message: "gateway timeout", cause })
    assert.equal(err.cause, cause)
  })
})

describe("PayloadError", () => {
  it("creates a tagged error with message", () => {
    const err = new PayloadError({ message: "missing field" })
    assert.equal(err._tag, "PayloadError")
    assert.equal(err.message, "missing field")
  })
})

describe("ConfigurationError", () => {
  it("creates an error with the given message", () => {
    const err = new ConfigurationError("missing auth")
    assert.equal(err.message, "missing auth")
    assert.equal(err.name, "ConfigurationError")
    assert(err instanceof Error)
  })
})
