/**
 * Chat bridge unit tests.
 *
 * These tests exercise the Effect-based generateReply function by
 * providing a mock RepochatAgent via Layer injection — no module
 * mocking needed.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Effect, Layer } from "effect"
import { RepochatAgent, type AgentService } from "./agent.ts"
import { generateReply } from "./chat.ts"
import { AgentError } from "./errors.ts"

// ── Mock Agent ──────────────────────────────────────────────────

const makeMockAgent = (response: string): AgentService => ({
  name: "repochat-mock",
  generate: async () => ({ text: response }),
})

const makeMockAgentLayer = (response: string) =>
  Layer.succeed(RepochatAgent, makeMockAgent(response))

const makeFailingAgentLayer = (error: Error) =>
  Layer.succeed(RepochatAgent, {
    name: "repochat-mock",
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
      name: "repochat-spy",
      generate: async (_msg, opts) => {
        capturedArgs = opts ?? {}
        return { text: "ok" }
      },
    }

    const program = generateReply(request).pipe(
      Effect.provide(Layer.succeed(RepochatAgent, spyAgent)),
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
      name: "repochat-spy",
      generate: async (_msg, opts) => {
        capturedArgs = opts ?? {}
        return { text: "ok" }
      },
    }

    const program = generateReply(request).pipe(
      Effect.provide(Layer.succeed(RepochatAgent, spyAgent)),
    )

    await Effect.runPromise(program)
    assert.equal(capturedArgs.resourceId, undefined, "should not pass deprecated resourceId")
    assert.equal(capturedArgs.threadId, undefined, "should not pass deprecated threadId")
  })
})
