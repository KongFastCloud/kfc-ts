/**
 * Chat bridge unit tests.
 *
 * These tests exercise the Effect-based generateReply function by
 * providing a mock SeerAgent via Layer injection — no module
 * mocking needed.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Effect, Layer } from "effect"
import { SeerAgent, type AgentService } from "./agent.ts"
import { generateReply } from "./chat.ts"
import { AgentError } from "./errors.ts"

// ── Mock Agent ──────────────────────────────────────────────────

const makeMockAgent = (response: string): AgentService => ({
  name: "seer-mock",
  generate: async () => ({ text: response }),
})

const makeMockAgentLayer = (response: string) =>
  Layer.succeed(SeerAgent, makeMockAgent(response))

const makeFailingAgentLayer = (error: Error) =>
  Layer.succeed(SeerAgent, {
    name: "seer-mock",
    generate: async () => { throw error },
  } satisfies AgentService)

// ── Tests ───────────────────────────────────────────────────────

describe("generateReply", () => {
  const request = {
    threadId: "gchat:spaces/S1/threads/T1",
    userId: "gchat:users/U1",
    text: "What does this repo do?",
  }

  it("returns the agent response text", async () => {
    const program = generateReply(request).pipe(
      Effect.provide(makeMockAgentLayer("It's a monorepo for KFC tooling.")),
    )

    const result = await Effect.runPromise(program)
    assert.equal(result.text, "It's a monorepo for KFC tooling.")
  })

  it("returns AgentError when the agent call fails", async () => {
    const program = generateReply(request).pipe(
      Effect.provide(makeFailingAgentLayer(new Error("gateway timeout"))),
      Effect.flip, // flip so the error becomes the success channel
    )

    const error = await Effect.runPromise(program)
    assert.equal(error._tag, "AgentError")
    assert.ok(error instanceof AgentError)
    assert.equal(error.message, "gateway timeout")
  })

  it("passes memory thread and resource through to the agent", async () => {
    let capturedArgs: Record<string, unknown> = {}

    const spyAgent: AgentService = {
      name: "seer-spy",
      generate: async (_msg, opts) => {
        capturedArgs = opts ?? {}
        return { text: "ok" }
      },
    }

    const program = generateReply(request).pipe(
      Effect.provide(Layer.succeed(SeerAgent, spyAgent)),
    )

    await Effect.runPromise(program)

    const memory = capturedArgs.memory as { thread: string; resource: string }
    assert.ok(memory, "memory option should be provided")
    assert.equal(memory.thread, "gchat:spaces/S1/threads/T1")
    assert.equal(memory.resource, "gchat:users/U1")
  })

  it("does not pass deprecated resourceId or threadId", async () => {
    let capturedArgs: Record<string, unknown> = {}

    const spyAgent: AgentService = {
      name: "seer-spy",
      generate: async (_msg, opts) => {
        capturedArgs = opts ?? {}
        return { text: "ok" }
      },
    }

    const program = generateReply(request).pipe(
      Effect.provide(Layer.succeed(SeerAgent, spyAgent)),
    )

    await Effect.runPromise(program)
    assert.equal(capturedArgs.resourceId, undefined, "should not pass deprecated resourceId")
    assert.equal(capturedArgs.threadId, undefined, "should not pass deprecated threadId")
  })

  // ── Final-answer-only contract ──────────────────────────────────

  it("returns only { text } — no streaming, no intermediate fields", async () => {
    const program = generateReply(request).pipe(
      Effect.provide(makeMockAgentLayer("Final answer.")),
    )

    const result = await Effect.runPromise(program)
    assert.deepEqual(Object.keys(result), ["text"], "response should contain only 'text' field")
    assert.equal(typeof result.text, "string")
  })

  // ── Error handling contract ─────────────────────────────────────

  it("wraps non-Error thrown values as AgentError with stringified cause", async () => {
    const throwStringLayer = Layer.succeed(SeerAgent, {
      name: "seer-mock",
      generate: async () => { throw "raw string failure" },
    } satisfies AgentService)

    const program = generateReply(request).pipe(
      Effect.provide(throwStringLayer),
      Effect.flip,
    )

    const error = await Effect.runPromise(program)
    assert.equal(error._tag, "AgentError")
    assert.equal(error.message, "raw string failure")
    assert.equal(error.cause, "raw string failure")
  })

  it("preserves original Error cause in AgentError", async () => {
    const originalError = new Error("upstream gateway 503")
    const program = generateReply(request).pipe(
      Effect.provide(makeFailingAgentLayer(originalError)),
      Effect.flip,
    )

    const error = await Effect.runPromise(program)
    assert.equal(error.cause, originalError)
  })

  it("AgentError is routable via Effect.catchTag", async () => {
    const program = generateReply(request).pipe(
      Effect.provide(makeFailingAgentLayer(new Error("boom"))),
      Effect.catchTag("AgentError", (err) =>
        Effect.succeed({ text: `caught: ${err.message}` }),
      ),
    )

    const result = await Effect.runPromise(program)
    assert.equal(result.text, "caught: boom")
  })

  // ── Memory identity scoping ─────────────────────────────────────

  it("same user across different threads produces same resource key", async () => {
    const capturedResources: string[] = []

    const spyAgent: AgentService = {
      name: "seer-spy",
      generate: async (_msg, opts) => {
        const mem = opts?.memory as { resource: string } | undefined
        if (mem) capturedResources.push(mem.resource)
        return { text: "ok" }
      },
    }

    const layer = Layer.succeed(SeerAgent, spyAgent)

    const req1 = { threadId: "gchat:spaces/S1/threads/T1", userId: "gchat:users/U1", text: "hi" }
    const req2 = { threadId: "gchat:spaces/S1/threads/T2", userId: "gchat:users/U1", text: "hello" }

    await Effect.runPromise(generateReply(req1).pipe(Effect.provide(layer)))
    await Effect.runPromise(generateReply(req2).pipe(Effect.provide(layer)))

    assert.equal(capturedResources.length, 2)
    assert.equal(capturedResources[0], capturedResources[1], "same user should produce same resource key across threads")
  })

  it("different users in same thread produce different resource keys", async () => {
    const capturedResources: string[] = []

    const spyAgent: AgentService = {
      name: "seer-spy",
      generate: async (_msg, opts) => {
        const mem = opts?.memory as { resource: string } | undefined
        if (mem) capturedResources.push(mem.resource)
        return { text: "ok" }
      },
    }

    const layer = Layer.succeed(SeerAgent, spyAgent)

    const req1 = { threadId: "gchat:spaces/S1/threads/T1", userId: "gchat:users/U1", text: "hi" }
    const req2 = { threadId: "gchat:spaces/S1/threads/T1", userId: "gchat:users/U2", text: "hello" }

    await Effect.runPromise(generateReply(req1).pipe(Effect.provide(layer)))
    await Effect.runPromise(generateReply(req2).pipe(Effect.provide(layer)))

    assert.equal(capturedResources.length, 2)
    assert.notEqual(capturedResources[0], capturedResources[1], "different users should produce different resource keys")
  })

  it("different threads produce different thread keys for memory history", async () => {
    const capturedThreads: string[] = []

    const spyAgent: AgentService = {
      name: "seer-spy",
      generate: async (_msg, opts) => {
        const mem = opts?.memory as { thread: string } | undefined
        if (mem) capturedThreads.push(mem.thread)
        return { text: "ok" }
      },
    }

    const layer = Layer.succeed(SeerAgent, spyAgent)

    const req1 = { threadId: "gchat:spaces/S1/threads/T1", userId: "gchat:users/U1", text: "hi" }
    const req2 = { threadId: "gchat:spaces/S1/threads/T2", userId: "gchat:users/U1", text: "hello" }

    await Effect.runPromise(generateReply(req1).pipe(Effect.provide(layer)))
    await Effect.runPromise(generateReply(req2).pipe(Effect.provide(layer)))

    assert.equal(capturedThreads.length, 2)
    assert.notEqual(capturedThreads[0], capturedThreads[1], "different threads should produce different thread keys")
  })
})
