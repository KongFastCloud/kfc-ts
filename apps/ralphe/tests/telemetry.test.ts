/**
 * ABOUTME: Tests for the Effect-native OpenTelemetry tracing integration.
 * Verifies fail-open behavior (effects work without tracing layer), span
 * export via TracingLive, and that tracing does not alter success or failure
 * outcomes of wrapped Effects.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import {
  initTelemetry,
  shutdownTelemetry,
  TracingLive,
  _resetForTesting,
} from "../src/telemetry.js"

// ---------------------------------------------------------------------------
// In-memory span capture via global provider
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let provider: BasicTracerProvider

beforeEach(() => {
  trace.disable()
  exporter = new InMemorySpanExporter()
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  trace.setGlobalTracerProvider(provider)
})

afterEach(async () => {
  await provider.forceFlush()
  await provider.shutdown()
  trace.disable()
})

const spanNames = (): string[] =>
  exporter.getFinishedSpans().map((s) => s.name)

// ---------------------------------------------------------------------------
// initTelemetry
// ---------------------------------------------------------------------------

describe("initTelemetry", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(async () => {
    await shutdownTelemetry()
    _resetForTesting()
    delete process.env.AXIOM_TOKEN
    delete process.env.AXIOM_DATASET
    delete process.env.AXIOM_DOMAIN
  })

  test("is a no-op when AXIOM env vars are missing", () => {
    delete process.env.AXIOM_TOKEN
    delete process.env.AXIOM_DATASET
    delete process.env.AXIOM_DOMAIN

    expect(() => initTelemetry()).not.toThrow()
  })

  test("is a no-op when only some env vars are set", () => {
    process.env.AXIOM_TOKEN = "test-token"
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

// ---------------------------------------------------------------------------
// Fail-open: effects work without any tracing layer
// ---------------------------------------------------------------------------

describe("fail-open behavior", () => {
  test("effects run normally without tracing layer", async () => {
    const result = await Effect.runPromise(
      Effect.succeed("all good").pipe(
        Effect.withSpan("agent.execute"),
        Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 2 } }),
        Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } }),
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      ),
    )
    expect(result).toBe("all good")
  })

  test("failing effect propagates error without tracing layer", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail("boom").pipe(
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("nested withSpan succeeds without tracing layer", async () => {
    const result = await Effect.runPromise(
      Effect.succeed("nested-ok").pipe(
        Effect.withSpan("agent.execute"),
        Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1 } }),
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      ),
    )
    expect(result).toBe("nested-ok")
  })
})

// ---------------------------------------------------------------------------
// Span export with tracing layer
// ---------------------------------------------------------------------------

describe("span export with tracing layer", () => {
  test("successful effect returns its value", async () => {
    const result = await Effect.runPromise(
      Effect.succeed(42).pipe(
        Effect.withSpan("test.span", { attributes: { key: "value" } }),
        Effect.provide(TracingLive),
      ),
    )
    expect(result).toBe(42)
  })

  test("failing effect propagates the error", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail("boom").pipe(
        Effect.withSpan("test.span"),
        Effect.provide(TracingLive),
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("span is exported with correct name", async () => {
    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
        Effect.provide(TracingLive),
      ),
    )
    expect(spanNames()).toContain("task.run")
  })

  test("span carries attributes", async () => {
    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("task.run", { attributes: { engine: "claude", "issue.id": "TST-1" } }),
        Effect.provide(TracingLive),
      ),
    )
    const taskSpans = exporter.getFinishedSpans().filter((s) => s.name === "task.run")
    expect(taskSpans).toHaveLength(1)
    expect(taskSpans[0]!.attributes["engine"]).toBe("claude")
    expect(taskSpans[0]!.attributes["issue.id"]).toBe("TST-1")
  })

  test("nested spans produce multiple exported spans", async () => {
    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("agent.execute"),
        Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1 } }),
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
        Effect.provide(TracingLive),
      ),
    )
    expect(spanNames()).toContain("task.run")
    expect(spanNames()).toContain("loop.attempt")
    expect(spanNames()).toContain("agent.execute")
  })

  test("span does not change success/failure outcomes on error", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail("task-error").pipe(
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
        Effect.provide(TracingLive),
      ),
    )
    expect(exit._tag).toBe("Failure")
    // Span is still exported despite failure
    expect(spanNames()).toContain("task.run")
  })
})
