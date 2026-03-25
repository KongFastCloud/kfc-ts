/**
 * Runtime layer integration tests — tool composition and degradation paths.
 *
 * Verifies that the RepochatAgent layer correctly composes tools from
 * all sources (codemogger MCP, GlitchTip MCP, native read_file) and
 * degrades gracefully when any integration is unavailable.
 *
 * Key invariants tested:
 *   - read_file is always present (native, never optional)
 *   - codemogger tools are included when available
 *   - GlitchTip tools are included when available
 *   - failures in any tool source don't prevent agent creation
 *   - chat works regardless of tool availability
 *
 * Run with: pnpm test:integration
 * (requires --experimental-test-module-mocks)
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Context, Effect, Layer } from "effect"

// ── Controllable mock state ──────────────────────────────────────

/** Controls what createGlitchTipClient returns in each test. */
let mockGlitchtipFactory: () => unknown = () => null

/** Controls what createCodemoggerClient returns in each test. */
let mockCodemoggerFactory: () => unknown = () => null

/** Records calls to makeRepochatAgent for assertions. */
const makeRepochatAgentCalls: Array<{ tools?: Record<string, unknown> }> = []

function resetMocks() {
  mockGlitchtipFactory = () => null
  mockCodemoggerFactory = () => null
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

// ── Fake read_file tool (stands in for the real native tool) ─────

const fakeReadFileTool = {
  id: "read_file",
  description: "mock read_file",
  execute: async () => ({ path: "x", content: "x", totalLines: 1, range: { start: 1, end: 1 } }),
}

// ── Mock modules ─────────────────────────────────────────────────

mock.module("../mcp.ts", {
  namedExports: {
    createGlitchTipClient: () => mockGlitchtipFactory(),
    createCodemoggerClient: () => mockCodemoggerFactory(),
  },
})

mock.module("../tools/index.ts", {
  namedExports: {
    readFileTool: fakeReadFileTool,
  },
})

mock.module("../agent.ts", {
  namedExports: {
    makeRepochatAgent: (tools?: Record<string, unknown>) => {
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

/** Extract the tool names passed to the last makeRepochatAgent call. */
function lastToolNames(): string[] {
  const last = makeRepochatAgentCalls[makeRepochatAgentCalls.length - 1]
  if (!last?.tools) return []
  return Object.keys(last.tools)
}

// ── Tests ────────────────────────────────────────────────────────

// ── read_file is always present ──────────────────────────────────

describe("RepochatAgent layer — read_file native tool", () => {
  beforeEach(() => resetMocks())

  it("always includes read_file even when both MCP sources are unavailable", async () => {
    mockGlitchtipFactory = () => null
    mockCodemoggerFactory = () => null

    await buildAgent()

    assert.equal(makeRepochatAgentCalls.length, 1)
    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should always be present")
  })

  it("read_file survives codemogger failure", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => { throw new Error("codemogger not installed") },
    })

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should survive codemogger failure")
  })

  it("read_file survives GlitchTip failure", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => { throw new Error("GlitchTip unreachable") },
    })

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should survive GlitchTip failure")
  })
})

// ── Codemogger integration ───────────────────────────────────────

describe("RepochatAgent layer — codemogger available", () => {
  beforeEach(() => resetMocks())

  it("includes codemogger tools when getTools() succeeds", async () => {
    const fakeCodemoggerTools = {
      "codemogger_search": { description: "Search code", execute: async () => ({}) },
      "codemogger_lookup": { description: "Lookup symbol", execute: async () => ({}) },
    }

    mockCodemoggerFactory = () => ({
      getTools: async () => fakeCodemoggerTools,
    })

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(tools.includes("codemogger_search"), "codemogger search tool should be present")
    assert.ok(tools.includes("codemogger_lookup"), "codemogger lookup tool should be present")
    assert.ok(tools.includes("read_file"), "read_file should still be present alongside codemogger")
  })

  it("merges codemogger and GlitchTip tools together with read_file", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => ({
        "codemogger_search": { description: "Search code", execute: async () => ({}) },
      }),
    })

    mockGlitchtipFactory = () => ({
      getTools: async () => ({
        "list-issues": { description: "List GlitchTip issues", execute: async () => ({}) },
      }),
    })

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(tools.includes("codemogger_search"), "codemogger should be present")
    assert.ok(tools.includes("list-issues"), "GlitchTip should be present")
    assert.ok(tools.includes("read_file"), "read_file should be present")
    assert.equal(tools.length, 3, "should have exactly 3 tools")
  })
})

// ── Codemogger degradation ───────────────────────────────────────

describe("RepochatAgent layer — codemogger unavailable", () => {
  beforeEach(() => resetMocks())

  it("creates agent without codemogger tools when client is null", async () => {
    mockCodemoggerFactory = () => null

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(!tools.includes("codemogger_search"), "codemogger tools should not be present")
    assert.ok(tools.includes("read_file"), "read_file should still be present")
  })

  it("falls back gracefully when codemogger getTools() throws (not installed)", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => {
        throw new Error("ENOENT: npx codemogger not found")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created")
    const tools = lastToolNames()
    assert.ok(!tools.some(t => t.startsWith("codemogger")), "no codemogger tools after failure")
    assert.ok(tools.includes("read_file"), "read_file should survive codemogger failure")
  })

  it("falls back gracefully when codemogger getTools() throws timeout", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => {
        throw new Error("MCP request timed out after 10000ms")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created despite codemogger timeout")
    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should be present")
  })

  it("agent responds to questions when codemogger is unavailable", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => { throw new Error("codemogger down") },
    })

    const agent = await buildAgent()
    const result = await agent.generate("What does this repo do?")

    assert.ok(result.text, "agent should produce a response without codemogger")
  })
})

// ── GlitchTip unavailable (preserved from original tests) ────────

describe("RepochatAgent layer — GlitchTip unavailable", () => {
  beforeEach(() => resetMocks())

  it("creates agent with only read_file when both MCP sources are not configured", async () => {
    mockGlitchtipFactory = () => null
    mockCodemoggerFactory = () => null

    const agent = await buildAgent()

    assert.ok(agent, "agent should be created")
    assert.equal(agent.name, "repochat-mock")
    assert.equal(makeRepochatAgentCalls.length, 1)
    const tools = lastToolNames()
    assert.deepEqual(tools, ["read_file"],
      "only read_file should be present when both MCP sources are unavailable")
  })

  it("agent responds to normal codebase questions without GlitchTip", async () => {
    mockGlitchtipFactory = () => null

    const agent = await buildAgent()
    const result = await agent.generate("What does this repo do?")

    assert.ok(result.text, "agent should produce a response")
    assert.equal(typeof result.text, "string")
  })
})

describe("RepochatAgent layer — GlitchTip getTools() failure", () => {
  beforeEach(() => resetMocks())

  it("falls back to read_file-only when GlitchTip getTools() throws (unreachable)", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => {
        throw new Error("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8000")
      },
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should still be created")
    const tools = lastToolNames()
    assert.ok(!tools.includes("list-issues"), "GlitchTip tools should not be present")
    assert.ok(tools.includes("read_file"), "read_file should be present")
  })

  it("falls back when GlitchTip throws auth error", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => {
        throw new Error("401 Unauthorized: Invalid authentication credentials")
      },
    })

    await buildAgent()

    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should be present after auth failure")
    assert.ok(!tools.some(t => t.includes("issue")), "no GlitchTip tools after auth failure")
  })

  it("agent still generates replies after GlitchTip getTools() failure", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => {
        throw new Error("503 Service Unavailable")
      },
    })

    const agent = await buildAgent()
    const result = await agent.generate("Explain the folder structure")

    assert.ok(result.text, "agent should respond even after MCP failure")
  })
})

// ── GlitchTip tools loaded successfully ──────────────────────────

describe("RepochatAgent layer — GlitchTip tools loaded successfully", () => {
  beforeEach(() => resetMocks())

  it("passes GlitchTip tools alongside read_file to makeRepochatAgent", async () => {
    const fakeTools = {
      "list-issues": { description: "List GlitchTip issues", execute: async () => ({}) },
      "get-issue": { description: "Get issue details", execute: async () => ({}) },
    }

    mockGlitchtipFactory = () => ({
      getTools: async () => fakeTools,
    })

    await buildAgent()

    assert.equal(makeRepochatAgentCalls.length, 1)
    const tools = lastToolNames()
    assert.ok(tools.includes("list-issues"), "GlitchTip list-issues should be present")
    assert.ok(tools.includes("get-issue"), "GlitchTip get-issue should be present")
    assert.ok(tools.includes("read_file"), "read_file should be present alongside GlitchTip")
  })

  it("agent generates replies when GlitchTip tools are available", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => ({
        "list-issues": { description: "List issues", execute: async () => ({}) },
      }),
    })

    const agent = await buildAgent()
    const result = await agent.generate("Show me recent GlitchTip errors")

    assert.ok(result.text, "agent should produce a response with tools loaded")
  })
})

// ── Malformed responses ──────────────────────────────────────────

describe("RepochatAgent layer — malformed getTools() responses", () => {
  beforeEach(() => resetMocks())

  it("handles codemogger getTools() returning null gracefully", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => null,
    })

    const agent = await buildAgent()
    assert.ok(agent, "agent should be created when codemogger getTools returns null")
    const tools = lastToolNames()
    assert.ok(tools.includes("read_file"), "read_file should be present")
  })

  it("handles GlitchTip getTools() returning null gracefully", async () => {
    mockGlitchtipFactory = () => ({
      getTools: async () => null,
    })

    const agent = await buildAgent()
    assert.ok(agent, "agent should be created when GlitchTip getTools returns null")
  })

  it("handles both getTools() returning empty objects", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => ({}),
    })
    mockGlitchtipFactory = () => ({
      getTools: async () => ({}),
    })

    const agent = await buildAgent()

    assert.ok(agent, "agent should be created with empty tools maps")
    const tools = lastToolNames()
    assert.deepEqual(tools, ["read_file"],
      "only read_file should be present when MCP tools are empty objects")
  })
})

// ── Chat isolation from tool availability ────────────────────────

describe("chat flow isolation from tool availability", () => {
  beforeEach(() => resetMocks())

  it("chat flow works identically across all tool availability scenarios", async () => {
    // Scenario 1: no MCP tools
    mockGlitchtipFactory = () => null
    mockCodemoggerFactory = () => null
    const agentMinimal = await buildAgent()
    const replyMinimal = await agentMinimal.generate("What is this repo?")

    resetMocks()

    // Scenario 2: codemogger only
    mockGlitchtipFactory = () => null
    mockCodemoggerFactory = () => ({
      getTools: async () => ({
        "codemogger_search": { description: "Search", execute: async () => ({}) },
      }),
    })
    const agentCodemogger = await buildAgent()
    const replyCodemogger = await agentCodemogger.generate("What is this repo?")

    resetMocks()

    // Scenario 3: all tools
    mockGlitchtipFactory = () => ({
      getTools: async () => ({
        "list-issues": { description: "List issues", execute: async () => ({}) },
      }),
    })
    mockCodemoggerFactory = () => ({
      getTools: async () => ({
        "codemogger_search": { description: "Search", execute: async () => ({}) },
      }),
    })
    const agentFull = await buildAgent()
    const replyFull = await agentFull.generate("What is this repo?")

    // All should produce valid responses
    assert.ok(replyMinimal.text, "minimal agent should respond")
    assert.ok(replyCodemogger.text, "codemogger-only agent should respond")
    assert.ok(replyFull.text, "fully-equipped agent should respond")
  })

  it("codemogger failure does not propagate errors to the chat flow", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => { throw new Error("codemogger is on fire") },
    })

    const agent = await buildAgent()
    const result = await agent.generate("How are tests structured?")

    assert.ok(result.text, "normal chat should work after codemogger failure")
    assert.equal(typeof result.text, "string")
  })

  it("simultaneous codemogger + GlitchTip failures still allow chat", async () => {
    mockCodemoggerFactory = () => ({
      getTools: async () => { throw new Error("codemogger crashed") },
    })
    mockGlitchtipFactory = () => ({
      getTools: async () => { throw new Error("GlitchTip crashed") },
    })

    const agent = await buildAgent()
    const result = await agent.generate("Explain the architecture")

    assert.ok(result.text, "chat should work even when all MCP sources fail")
    const tools = lastToolNames()
    assert.deepEqual(tools, ["read_file"],
      "only read_file should remain after all MCP failures")
  })
})
