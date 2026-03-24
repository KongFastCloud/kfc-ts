import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { repochatAgent, RepochatAgent } from "./agent.ts"

describe("repochatAgent", () => {
  it("is an AgentService instance with generate method", () => {
    assert.ok(repochatAgent)
    assert.equal(typeof repochatAgent.generate, "function")
  })

  it("has the correct agent name", () => {
    assert.equal(repochatAgent.name, "repochat")
  })
})

describe("RepochatAgent tag", () => {
  it("has the correct service key", () => {
    assert.equal(RepochatAgent.key, "RepochatAgent")
  })
})
