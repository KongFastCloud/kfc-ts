import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { repochatAgent, makeRepochatAgent, RepochatAgent } from "./agent.ts"

describe("repochatAgent", () => {
  it("is an AgentService instance with generate method", () => {
    assert.ok(repochatAgent)
    assert.equal(typeof repochatAgent.generate, "function")
  })

  it("has the correct agent name", () => {
    assert.equal(repochatAgent.name, "repochat")
  })
})

describe("makeRepochatAgent", () => {
  it("creates an agent without tools when called with no arguments", () => {
    const agent = makeRepochatAgent()
    assert.ok(agent)
    assert.equal(agent.name, "repochat")
    assert.equal(typeof agent.generate, "function")
  })

  it("creates an agent with tools when tools are provided", () => {
    const stubTool = {
      description: "stub",
      execute: async () => ({ result: "ok" }),
    }
    const agent = makeRepochatAgent({ myTool: stubTool } as any)
    assert.ok(agent)
    assert.equal(agent.name, "repochat")
    assert.equal(typeof agent.generate, "function")
  })
})

describe("RepochatAgent tag", () => {
  it("has the correct service key", () => {
    assert.equal(RepochatAgent.key, "RepochatAgent")
  })
})
