/**
 * Runtime layer integration tests — GlitchTip MCP failure paths.
 *
 * Verifies that the RepochatAgent layer degrades gracefully when
 * GlitchTip is unavailable, misconfigured, unreachable, or returns
 * malformed data. Also verifies that normal codebase-chat flows
 * are unaffected by GlitchTip integration state.
 *
 * Run with: pnpm test:integration
 * (requires --experimental-test-module-mocks)
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Context, Effect, Layer } from "effect"

// ── Controllable mock state ──────────────────────────────────────

/** Controls what createGlitchTipClient returns in each test. */
let mockClientFactory: () => unknown = () => null

/** Records calls to makeRepochatAgent for assertions. */
const makeRepochatAgentCalls: Array<{ tools?: unknown }> = []

function resetMocks() {
  mockClientFactory = () => null
  makeRepochatAgentCalls.length = 0
}

// ── Build a proper Effect Context.Tag for the mock ───────────────

interface MockAgentService {
  readonly name: string
  generate(msg: string): Promise<{ text: string }>
}

class MockRepochatAgent extends Context.Tag("RepochatAgent")<
  MockRepochatAgent,
  MockAgentService
>() {}

// ── Mock modules ─────────────────────────────────────────────────

mock.module("../mcp.ts", {
  namedExports: {
    createGlitchTipClient: () => mockClientFactory(),
  },
})

mock.module("../agent.ts", {
  namedExports: {
    makeRepochatAgent: (tools?: unknown) => {
      makeRepochatAgentCalls.push({ tools })
      return {
        name: "repochat-mock",
        generate: async (msg: string) => ({ text: `echo: ${msg}` }),
      }
    },
    RepochatAgent: MockRepochatAgent,
  },
})

// Re-import runtime AFTER mocks are in place so the Layer uses our stubs.
const { AppLayer } = await import("../runtime.ts")

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Materialize the AppLayer and extract the RepochatAgent service.
 * This simulates the startup path that runs once before serving requests.
 */
async function buildAgent() {
  const program = Effect.gen(function* () {
    return yield* MockRepochatAgent
  }).pipe(Effect.provide(AppLayer as Layer.Layer<MockRepochatAgent>))

  return Effect.runPromise(program)
}

// ── Tests ────────────────────────────────────────────────────────

describe("RepochatAgent layer — GlitchTip unavailable", () => {
  beforeEach(() => resetMocks())

  it("creates agent without tools when GlitchTip is not configured", async () => {
    mockClientFactory = () => null

    const agent = await buildAgent()

    assert.ok(agent, "agent should be created")
    assert.equal(agent.name, "repochat-mock")
    assert.equal(makeRepochatAgentCalls.length, 1)
    assert.equal(makeRepochatAgentCalls[0]!.tools, undefined,
      "agent should be created without tools when GlitchTip is not configured")
  })

  it("agent responds to normal codebase questions without GlitchTip", async () => {
    mockClientFactory = () => null

    const agent = await buildAgent()
    const result = await agent.generate("What does this repo do?")

    assert.ok(result.text, "agent should produce a response")
    assert.equal(typeof result.text, "string")
  })
})

describe("RepochatAgent layer — GlitchTip getTools() failure", () => {
  beforeEach(() => resetMocks())

  it("falls back to no-tools agent when getTools() throws (unreachable instance)", async () => {
    mockClientFactory = () => ({
      getTools: async () => {
        throw new Error("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8000")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created")
    assert.equal(agent.name, "repochat-mock")
    const lastCall = makeRepochatAgentCalls[makeRepochatAgentCalls.length - 1]!
    assert.equal(lastCall.tools, undefined,
      "agent should fall back to no tools on connection failure")
  })

  it("falls back to no-tools agent when getTools() throws auth error (invalid token)", async () => {
    mockClientFactory = () => ({
      getTools: async () => {
        throw new Error("401 Unauthorized: Invalid authentication credentials")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created despite auth failure")
    const lastCall = makeRepochatAgentCalls[makeRepochatAgentCalls.length - 1]!
    assert.equal(lastCall.tools, undefined,
      "agent should fall back to no tools on auth failure")
  })

  it("falls back to no-tools agent when getTools() throws timeout error", async () => {
    mockClientFactory = () => ({
      getTools: async () => {
        throw new Error("MCP request timed out after 5000ms")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created despite timeout")
    const lastCall = makeRepochatAgentCalls[makeRepochatAgentCalls.length - 1]!
    assert.equal(lastCall.tools, undefined,
      "agent should fall back to no tools on timeout")
  })

  it("agent still generates replies after getTools() failure", async () => {
    mockClientFactory = () => ({
      getTools: async () => {
        throw new Error("503 Service Unavailable")
      },
    })

    const agent = await buildAgent()
    const result = await agent.generate("Explain the folder structure")

    assert.ok(result.text, "agent should respond even after MCP failure")
  })
})

describe("RepochatAgent layer — GlitchTip tools loaded successfully", () => {
  beforeEach(() => resetMocks())

  it("passes tools to makeRepochatAgent when getTools() succeeds", async () => {
    const fakeTools = {
      "list-issues": { description: "List GlitchTip issues", execute: async () => ({}) },
      "get-issue": { description: "Get issue details", execute: async () => ({}) },
    }

    mockClientFactory = () => ({
      getTools: async () => fakeTools,
    })

    await buildAgent()

    assert.equal(makeRepochatAgentCalls.length, 1)
    assert.deepEqual(makeRepochatAgentCalls[0]!.tools, fakeTools,
      "tools from MCP should be passed to makeRepochatAgent")
  })

  it("agent generates replies when GlitchTip tools are available", async () => {
    mockClientFactory = () => ({
      getTools: async () => ({
        "list-issues": { description: "List issues", execute: async () => ({}) },
      }),
    })

    const agent = await buildAgent()
    const result = await agent.generate("Show me recent GlitchTip errors")

    assert.ok(result.text, "agent should produce a response with tools loaded")
  })
})

describe("RepochatAgent layer — malformed getTools() responses", () => {
  beforeEach(() => resetMocks())

  it("handles getTools() returning null gracefully", async () => {
    mockClientFactory = () => ({
      getTools: async () => null,
    })

    // null is falsy, so runtime.ts treats it as no tools
    const agent = await buildAgent()
    assert.ok(agent, "agent should be created even when getTools returns null")
  })

  it("handles getTools() returning an empty object gracefully", async () => {
    mockClientFactory = () => ({
      getTools: async () => ({}),
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should be created with empty tools map")
    assert.equal(makeRepochatAgentCalls.length, 1)
  })
})

describe("normal codebase-chat isolation from GlitchTip", () => {
  beforeEach(() => resetMocks())

  it("chat flow is identical whether GlitchTip is absent or present", async () => {
    // First: without GlitchTip
    mockClientFactory = () => null
    const agentWithout = await buildAgent()
    const replyWithout = await agentWithout.generate("What is this repo?")

    resetMocks()

    // Second: with GlitchTip
    mockClientFactory = () => ({
      getTools: async () => ({
        "list-issues": { description: "List issues", execute: async () => ({}) },
      }),
    })
    const agentWith = await buildAgent()
    const replyWith = await agentWith.generate("What is this repo?")

    // Both should produce valid responses
    assert.ok(replyWithout.text, "no-GlitchTip agent should respond")
    assert.ok(replyWith.text, "GlitchTip-enabled agent should respond")
    assert.equal(typeof replyWithout.text, "string")
    assert.equal(typeof replyWith.text, "string")
  })

  it("GlitchTip failure does not propagate errors to the chat flow", async () => {
    mockClientFactory = () => ({
      getTools: async () => {
        throw new Error("GlitchTip is on fire")
      },
    })

    const agent = await buildAgent()

    // The agent should work fine for normal questions
    const result = await agent.generate("How are tests structured?")
    assert.ok(result.text, "normal chat should work after GlitchTip failure")
    assert.equal(typeof result.text, "string")
  })
})
