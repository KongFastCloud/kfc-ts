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

  test("is safe when AXIOM_DOMAIN is invalid (fail-open)", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "not-a-url"

    // Should not throw — exporter creation with an invalid URL is fail-open
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

describe("fail-open behavior", () => {
  test("withSpan succeeds when tracer.startSpan throws", async () => {
    // Install a tracer that throws on startSpan
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    const realProvider = traceApi.getTracerProvider()
    const fakeTracer = {
      startSpan: () => { throw new Error("boom") },
      startActiveSpan: () => { throw new Error("boom") },
    }
    const fakeProvider = { getTracer: () => fakeTracer }
    traceApi.setGlobalTracerProvider(fakeProvider as any)

    try {
      const result = await Effect.runPromise(
        withSpan("test.broken", { key: "value" }, Effect.succeed(99)),
      )
      expect(result).toBe(99)
    } finally {
      traceApi.disable()
    }
  })

  test("withSpan succeeds when span.end throws", async () => {
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    const fakeSpan = {
      end: () => { throw new Error("end failed") },
      setStatus: () => {},
      setAttribute: () => fakeSpan,
      setAttributes: () => fakeSpan,
      addEvent: () => fakeSpan,
      recordException: () => {},
      updateName: () => fakeSpan,
      isRecording: () => true,
      spanContext: () => ({ traceId: "0", spanId: "0", traceFlags: 0 }),
    }
    const fakeTracer = {
      startSpan: () => fakeSpan,
      startActiveSpan: () => {},
    }
    const fakeProvider = { getTracer: () => fakeTracer }
    traceApi.setGlobalTracerProvider(fakeProvider as any)

    try {
      const result = await Effect.runPromise(
        withSpan("test.bad-end", undefined, Effect.succeed("still ok")),
      )
      expect(result).toBe("still ok")
    } finally {
      traceApi.disable()
    }
  })

  test("withSpan propagates failure when span.setStatus throws", async () => {
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    const fakeSpan = {
      end: () => {},
      setStatus: () => { throw new Error("setStatus failed") },
      setAttribute: () => fakeSpan,
      setAttributes: () => fakeSpan,
      addEvent: () => fakeSpan,
      recordException: () => {},
      updateName: () => fakeSpan,
      isRecording: () => true,
      spanContext: () => ({ traceId: "0", spanId: "0", traceFlags: 0 }),
    }
    const fakeTracer = {
      startSpan: () => fakeSpan,
      startActiveSpan: () => {},
    }
    const fakeProvider = { getTracer: () => fakeTracer }
    traceApi.setGlobalTracerProvider(fakeProvider as any)

    try {
      // The effect fails, span.setStatus throws, but error still propagates
      const exit = await Effect.runPromiseExit(
        withSpan("test.bad-status", undefined, Effect.fail("original-error")),
      )
      expect(exit._tag).toBe("Failure")
    } finally {
      traceApi.disable()
    }
  })

  test("shutdownTelemetry is safe after init with valid config", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    // Shutdown should not throw even if flush/shutdown has issues
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
  })

  test("effects run normally with no env config (no-op tracer)", async () => {
    // No AXIOM_* env vars set, no initTelemetry() called
    const result = await Effect.runPromise(
      withSpan("task.run", { engine: "claude" },
        withSpan("loop.attempt", { "loop.attempt": 1, "loop.max_attempts": 2 },
          withSpan("agent.execute", undefined,
            withSpan("check.run", { "check.name": "echo test" },
              Effect.succeed("all good"),
            ),
          ),
        ),
      ),
    )
    expect(result).toBe("all good")
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
