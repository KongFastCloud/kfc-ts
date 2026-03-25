import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { seerAgent, makeSeerAgent, SeerAgent } from "./agent.ts"

describe("seerAgent", () => {
  it("is an AgentService instance with generate method", () => {
    assert.ok(seerAgent)
    assert.equal(typeof seerAgent.generate, "function")
  })

  it("has the correct agent name", () => {
    assert.equal(seerAgent.name, "seer")
  })
})

describe("makeSeerAgent", () => {
  it("creates an agent without tools when called with no arguments", () => {
    const agent = makeSeerAgent()
    assert.ok(agent)
    assert.equal(agent.name, "seer")
    assert.equal(typeof agent.generate, "function")
  })

  it("creates an agent with tools when tools are provided", () => {
    const stubTool = {
      description: "stub",
      execute: async () => ({ result: "ok" }),
    }
    const agent = makeSeerAgent({ myTool: stubTool } as any)
    assert.ok(agent)
    assert.equal(agent.name, "seer")
    assert.equal(typeof agent.generate, "function")
  })
})

describe("SeerAgent tag", () => {
  it("has the correct service key", () => {
    assert.equal(SeerAgent.key, "SeerAgent")
  })
})
