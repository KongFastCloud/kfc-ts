/**
 * ABOUTME: Tests that nested withSpan() calls produce a coherent trace tree
 * with shared trace IDs and correct parent-child relationships. Verifies the
 * core context propagation fix: child spans inherit the active trace context
 * instead of creating disconnected root spans.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { Effect, pipe } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"
import { withSpan } from "../src/telemetry.js"

// ---------------------------------------------------------------------------
// In-memory span capture
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const spanByName = (name: string): ReadableSpan | undefined =>
  exporter.getFinishedSpans().find((s) => s.name === name)

const spansByName = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((s) => s.name === name)

/** Extract the parent span ID from a ReadableSpan (OTel SDK v2 uses parentSpanContext). */
const parentSpanIdOf = (span: ReadableSpan): string | undefined =>
  span.parentSpanContext?.spanId

// ---------------------------------------------------------------------------
// Trace hierarchy tests
// ---------------------------------------------------------------------------

describe("trace hierarchy", () => {
  test("nested spans share the same trace ID", async () => {
    await Effect.runPromise(
      withSpan("task.run", { engine: "claude" },
        withSpan("loop.attempt", { "loop.attempt": 1 },
          withSpan("agent.execute", undefined,
            Effect.succeed("ok"),
          ),
        ),
      ),
    )

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!

    expect(taskSpan).toBeDefined()
    expect(loopSpan).toBeDefined()
    expect(agentSpan).toBeDefined()

    // All three spans must share the same trace ID
    const traceId = taskSpan.spanContext().traceId
    expect(loopSpan.spanContext().traceId).toBe(traceId)
    expect(agentSpan.spanContext().traceId).toBe(traceId)
  })

  test("child spans have correct parent span IDs", async () => {
    await Effect.runPromise(
      withSpan("task.run", undefined,
        withSpan("loop.attempt", undefined,
          withSpan("agent.execute", undefined,
            Effect.succeed("ok"),
          ),
        ),
      ),
    )

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!

    // task.run is the root — no parent
    expect(parentSpanIdOf(taskSpan)).toBeUndefined()

    // loop.attempt is a child of task.run
    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)

    // agent.execute is a child of loop.attempt
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpan.spanContext().spanId)
  })

  test("sibling spans share the same parent", async () => {
    await Effect.runPromise(
      withSpan("task.run", undefined,
        pipe(
          withSpan("agent.execute", undefined, Effect.succeed("done")),
          Effect.andThen(
            withSpan("check.run", { "check.name": "lint" }, Effect.succeed("pass")),
          ),
          Effect.andThen(
            withSpan("report.verify", undefined, Effect.succeed("verified")),
          ),
        ),
      ),
    )

    const taskSpan = spanByName("task.run")!
    const agentSpan = spanByName("agent.execute")!
    const checkSpan = spanByName("check.run")!
    const reportSpan = spanByName("report.verify")!

    const parentId = taskSpan.spanContext().spanId

    // All three are direct children of task.run
    expect(parentSpanIdOf(agentSpan)).toBe(parentId)
    expect(parentSpanIdOf(checkSpan)).toBe(parentId)
    expect(parentSpanIdOf(reportSpan)).toBe(parentId)

    // All share the same trace ID
    const traceId = taskSpan.spanContext().traceId
    expect(agentSpan.spanContext().traceId).toBe(traceId)
    expect(checkSpan.spanContext().traceId).toBe(traceId)
    expect(reportSpan.spanContext().traceId).toBe(traceId)
  })

  test("retry attempts are siblings under the same task trace", async () => {
    const attempt = (n: number) =>
      withSpan("loop.attempt", { "loop.attempt": n, "loop.max_attempts": 3 },
        withSpan("agent.execute", undefined, Effect.succeed("ok")),
      )

    await Effect.runPromise(
      withSpan("task.run", { engine: "claude" },
        pipe(
          attempt(1),
          Effect.andThen(attempt(2)),
          Effect.andThen(attempt(3)),
        ),
      ),
    )

    const taskSpan = spanByName("task.run")!
    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(3)

    const traceId = taskSpan.spanContext().traceId
    const taskSpanId = taskSpan.spanContext().spanId

    for (const attempt of attempts) {
      // Each attempt is a child of task.run
      expect(parentSpanIdOf(attempt)).toBe(taskSpanId)
      // All share the same trace ID
      expect(attempt.spanContext().traceId).toBe(traceId)
    }

    // agent.execute spans are children of their respective loop.attempt
    const agentSpans = spansByName("agent.execute")
    expect(agentSpans).toHaveLength(3)
    for (const agentSpan of agentSpans) {
      expect(agentSpan.spanContext().traceId).toBe(traceId)
      // Parent should be one of the loop.attempt span IDs
      const attemptIds = attempts.map((a) => a.spanContext().spanId)
      const parentId = parentSpanIdOf(agentSpan)
      expect(parentId).toBeDefined()
      expect(attemptIds).toContain(parentId!)
    }
  })

  test("full orchestration hierarchy mirrors expected tree", async () => {
    // task.run > loop.attempt > [agent.execute, check.run, report.verify]
    await Effect.runPromise(
      withSpan("task.run", { engine: "claude", "issue.id": "TST-1" },
        withSpan("loop.attempt", { "loop.attempt": 1, "loop.max_attempts": 1 },
          pipe(
            withSpan("agent.execute", undefined, Effect.succeed("code")),
            Effect.andThen(
              withSpan("check.run", { "check.name": "echo lint" }, Effect.succeed("pass")),
            ),
            Effect.andThen(
              withSpan("report.verify", undefined, Effect.succeed("verified")),
            ),
          ),
        ),
      ),
    )

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!
    const checkSpan = spanByName("check.run")!
    const reportSpan = spanByName("report.verify")!

    const traceId = taskSpan.spanContext().traceId

    // All 5 spans share one trace ID
    for (const s of [loopSpan, agentSpan, checkSpan, reportSpan]) {
      expect(s.spanContext().traceId).toBe(traceId)
    }

    // task.run is root
    expect(parentSpanIdOf(taskSpan)).toBeUndefined()

    // loop.attempt is child of task.run
    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)

    // agent, check, report are children of loop.attempt
    const loopSpanId = loopSpan.spanContext().spanId
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpanId)
    expect(parentSpanIdOf(checkSpan)).toBe(loopSpanId)
    expect(parentSpanIdOf(reportSpan)).toBe(loopSpanId)
  })

  test("error in child span preserves hierarchy", async () => {
    const exit = await Effect.runPromiseExit(
      withSpan("task.run", undefined,
        withSpan("loop.attempt", undefined,
          withSpan("agent.execute", undefined,
            Effect.fail("agent-error"),
          ),
        ),
      ),
    )

    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!

    // Hierarchy still intact despite error
    const traceId = taskSpan.spanContext().traceId
    expect(loopSpan.spanContext().traceId).toBe(traceId)
    expect(agentSpan.spanContext().traceId).toBe(traceId)

    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpan.spanContext().spanId)
  })

  test("each top-level withSpan creates an independent trace", async () => {
    await Effect.runPromise(
      withSpan("task.run", undefined, Effect.succeed("first")),
    )
    await Effect.runPromise(
      withSpan("task.run", undefined, Effect.succeed("second")),
    )

    const tasks = spansByName("task.run")
    expect(tasks).toHaveLength(2)

    // Two separate traces
    expect(tasks[0]!.spanContext().traceId).not.toBe(tasks[1]!.spanContext().traceId)
  })
})
