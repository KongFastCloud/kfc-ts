import { describe, test, expect } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { FatalError } from "../src/errors.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { loop } from "../src/loop.js"
import type { RalpheConfig } from "../src/config.js"

const baseConfig: RalpheConfig = {
  engine: "claude",
  maxAttempts: 2,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

/**
 * These tests verify the shared orchestration logic that runTask composes:
 * agent → checks → loop. We test the same composition pattern with mock engines
 * since runTask internally creates real engine layers.
 */
describe("shared executor orchestration", () => {
  test("agent + checks succeed on first attempt", async () => {
    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "done", resumeToken: "sess-123" } satisfies AgentResult),
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("implement feature", { feedback })
        return pipe(pipeline, Effect.andThen(cmd("echo ok")))
      },
      { maxAttempts: baseConfig.maxAttempts },
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
  })

  test("retry passes feedback on check failure then succeeds", async () => {
    let calls = 0
    const mockLayer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.succeed({ response: `attempt-${calls}`, resumeToken: "sess-abc" })
      },
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("fix bug", { feedback })
        return pipe(
          pipeline,
          Effect.andThen(
            calls === 0
              ? cmd("exit 1") // fail first attempt
              : cmd("echo ok"),
          ),
        )
      },
      { maxAttempts: 2 },
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(calls).toBe(2)
  })

  test("resume token is available from agent result", async () => {
    let capturedToken: string | undefined

    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "ok", resumeToken: "thread-xyz" }),
    })

    const workflow = agent("task", {}).pipe(
      Effect.tap((result) => {
        capturedToken = result.resumeToken
        return Effect.void
      }),
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(capturedToken).toBe("thread-xyz")
  })

  test("fatal error propagates without retry", async () => {
    let calls = 0
    const mockLayer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.fail(new FatalError({ command: "agent", message: "auth failed" }))
      },
    })

    const workflow = loop(
      (feedback) => agent("task", { feedback }),
      { maxAttempts: 3 },
    )

    const result = await Effect.runPromiseExit(Effect.provide(workflow, mockLayer))
    expect(calls).toBe(1)
    expect(result._tag).toBe("Failure")
  })

  test("agent result includes undefined resumeToken when not provided", async () => {
    let capturedToken: string | undefined = "not-set"

    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "ok" }),
    })

    const workflow = agent("task", {}).pipe(
      Effect.tap((result) => {
        capturedToken = result.resumeToken
        return Effect.void
      }),
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(capturedToken).toBeUndefined()
  })
})
