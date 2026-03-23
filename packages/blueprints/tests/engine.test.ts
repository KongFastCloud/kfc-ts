/**
 * ABOUTME: Tests for the Engine context tag.
 * Verifies the Engine can be provided via Effect layers.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine.js"

describe("Engine", () => {
  test("can be provided via Layer.succeed", async () => {
    const mockLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, _workDir: string) =>
        Effect.succeed({ response: "hello", resumeToken: "tok-1" } satisfies AgentResult),
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* Engine
        return yield* engine.execute("test prompt", "/tmp")
      }).pipe(Effect.provide(mockLayer)),
    )

    expect(result.response).toBe("hello")
    expect(result.resumeToken).toBe("tok-1")
  })

  test("supports undefined resume token", async () => {
    const mockLayer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "ok" }),
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* Engine
        return yield* engine.execute("test", "/tmp")
      }).pipe(Effect.provide(mockLayer)),
    )

    expect(result.response).toBe("ok")
    expect(result.resumeToken).toBeUndefined()
  })
})
