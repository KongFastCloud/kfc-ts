/**
 * ABOUTME: Tests for the OpenTelemetry telemetry bootstrap module.
 * Verifies fail-open behavior, no-op when unconfigured, span creation
 * via withSpan, and that tracing failures do not affect Effect outcomes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import {
  initTelemetry,
  shutdownTelemetry,
  getTracer,
  withSpan,
  _resetForTesting,
} from "../src/telemetry.js"

beforeEach(() => {
  _resetForTesting()
})

afterEach(async () => {
  await shutdownTelemetry()
  _resetForTesting()
  // Restore env
  delete process.env.AXIOM_TOKEN
  delete process.env.AXIOM_DATASET
  delete process.env.AXIOM_DOMAIN
})

describe("initTelemetry", () => {
  test("is a no-op when AXIOM env vars are missing", () => {
    delete process.env.AXIOM_TOKEN
    delete process.env.AXIOM_DATASET
    delete process.env.AXIOM_DOMAIN

    // Should not throw
    expect(() => initTelemetry()).not.toThrow()
  })

  test("is a no-op when only some env vars are set", () => {
    process.env.AXIOM_TOKEN = "test-token"
    // Missing AXIOM_DATASET and AXIOM_DOMAIN

    expect(() => initTelemetry()).not.toThrow()
  })

  test("initializes without error when all env vars are set", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"

    expect(() => initTelemetry()).not.toThrow()
  })

  test("is idempotent — second call is a no-op", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"

    initTelemetry()
    expect(() => initTelemetry()).not.toThrow()
  })
})

describe("getTracer", () => {
  test("returns a tracer even when unconfigured (no-op tracer)", () => {
    const tracer = getTracer()
    expect(tracer).toBeDefined()
    expect(typeof tracer.startSpan).toBe("function")
  })
})

describe("shutdownTelemetry", () => {
  test("is safe to call when not initialized", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
  })

  test("is safe to call after init with no config", async () => {
    initTelemetry()
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
  })
})

describe("withSpan", () => {
  test("successful effect returns its value", async () => {
    const result = await Effect.runPromise(
      withSpan("test.span", { key: "value" }, Effect.succeed(42)),
    )
    expect(result).toBe(42)
  })

  test("failing effect propagates the error", async () => {
    const exit = await Effect.runPromiseExit(
      withSpan(
        "test.span",
        undefined,
        Effect.fail("boom"),
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("works with no-op tracer (unconfigured)", async () => {
    // No initTelemetry() called, no env vars
    const result = await Effect.runPromise(
      withSpan("test.noop", { engine: "claude" }, Effect.succeed("ok")),
    )
    expect(result).toBe("ok")
  })

  test("works with initialized tracer", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    const result = await Effect.runPromise(
      withSpan("task.run", { engine: "claude", "issue.id": "TST-1" }, Effect.succeed("done")),
    )
    expect(result).toBe("done")
  })

  test("span does not change success/failure outcomes on error", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    const exit = await Effect.runPromiseExit(
      withSpan("task.run", { engine: "claude" }, Effect.fail("task-error")),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("nested spans work correctly", async () => {
    const result = await Effect.runPromise(
      withSpan(
        "task.run",
        { engine: "claude" },
        withSpan(
          "loop.attempt",
          { "loop.attempt": 1 },
          Effect.succeed("nested-ok"),
        ),
      ),
    )
    expect(result).toBe("nested-ok")
  })
})
