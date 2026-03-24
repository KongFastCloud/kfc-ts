/**
 * ABOUTME: Tests that failure-path scenarios preserve the expected trace hierarchy.
 * Covers failed attempts with nested step failures, retry sequences that ultimately
 * fail, partial pipelines that abort midway, and fail-open telemetry under hierarchy
 * failure conditions. All tests are deterministic and use in-memory exporters only —
 * no live Axiom access is required.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { trace, SpanStatusCode } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { withSpan } from "../src/telemetry.js"
import { type GitOps, buildCiGitStep } from "../src/runTask.js"
import { loop } from "../src/loop.js"

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

const parentSpanIdOf = (span: ReadableSpan): string | undefined =>
  span.parentSpanContext?.spanId

const allSpans = (): ReadableSpan[] => exporter.getFinishedSpans()

// ---------------------------------------------------------------------------
// Fake layers
// ---------------------------------------------------------------------------

const successEngineLayer = Layer.succeed(Engine, {
  execute: () => Effect.succeed({ response: "ok" } satisfies AgentResult),
})

const successGitOps: GitOps = {
  commit: () => Effect.succeed({ message: "feat: test", hash: "abc1234" }),
  push: () => Effect.succeed({ remote: "origin", ref: "main", output: "" }),
  waitCi: () =>
    Effect.succeed({
      runId: 1,
      status: "completed",
      conclusion: "success",
      url: "https://example.com",
      workflowName: "ci",
    }),
}

const failingCiGitOps: GitOps = {
  ...successGitOps,
  waitCi: () =>
    Effect.fail(
      new CheckFailure({
        command: "CI run 1",
        stderr: "CI failed",
        exitCode: 1,
      }),
    ),
}

const failingCommitGitOps: GitOps = {
  ...successGitOps,
  commit: () =>
    Effect.fail(
      new FatalError({ command: "git commit", message: "commit failed" }),
    ),
}

// ---------------------------------------------------------------------------
// Failed attempt spans still belong to the correct trace tree
// ---------------------------------------------------------------------------

describe("failed attempt spans belong to correct trace", () => {
  test("agent failure inside an attempt preserves hierarchy", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        withSpan(
          "agent.execute",
          undefined,
          Effect.fail(new FatalError({ command: "agent", message: "crash" })),
        ),
      ),
    )

    const exit = await Effect.runPromiseExit(pipeline)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!

    const traceId = taskSpan.spanContext().traceId

    // All spans share one trace ID
    expect(loopSpan.spanContext().traceId).toBe(traceId)
    expect(agentSpan.spanContext().traceId).toBe(traceId)

    // Parent-child intact
    expect(parentSpanIdOf(taskSpan)).toBeUndefined()
    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpan.spanContext().spanId)
  })

  test("check failure after successful agent preserves both spans in hierarchy", async () => {
    const attemptBody = pipe(
      withSpan("agent.execute", undefined, Effect.succeed("code generated")),
      Effect.andThen(
        withSpan(
          "check.run",
          { "check.name": "echo test" },
          Effect.fail(
            new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
          ),
        ),
      ),
    )

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        attemptBody,
      ),
    )

    const exit = await Effect.runPromiseExit(pipeline)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!
    const checkSpan = spanByName("check.run")!

    const traceId = taskSpan.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    // All 4 spans share the same trace ID
    for (const s of [loopSpan, agentSpan, checkSpan]) {
      expect(s.spanContext().traceId).toBe(traceId)
    }

    // agent and check are both children of loop.attempt
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpanId)
    expect(parentSpanIdOf(checkSpan)).toBe(loopSpanId)
  })

  test("nested step failure deep in pipeline preserves full hierarchy", async () => {
    // task.run > loop.attempt > agent.execute > (ok)
    //                         > check.run > (ok)
    //                         > git.commit > git.push > git.wait_ci > (fail)
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.gen(function* () {
          yield* withSpan("agent.execute", undefined, Effect.succeed("ok"))
          yield* withSpan(
            "check.run",
            { "check.name": "echo lint" },
            Effect.succeed("pass"),
          )
          yield* buildCiGitStep(failingCiGitOps)
        }).pipe(Effect.provide(successEngineLayer)),
      ),
    )

    const exit = await Effect.runPromiseExit(pipeline)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const traceId = taskSpan.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    // Every emitted span shares the trace and is under loop.attempt
    const stepNames = ["agent.execute", "check.run", "git.commit", "git.push", "git.wait_ci"]
    for (const name of stepNames) {
      const span = spanByName(name)
      expect(span).toBeDefined()
      expect(span!.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(span!)).toBe(loopSpanId)
    }

    // No disconnected root spans
    for (const span of allSpans()) {
      if (span.name === "task.run") {
        expect(parentSpanIdOf(span)).toBeUndefined()
      } else {
        expect(parentSpanIdOf(span)).toBeDefined()
      }
    }
  })

  test("fatal error mid-pipeline skips later spans but preserves earlier ones", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.gen(function* () {
          yield* withSpan("agent.execute", undefined, Effect.succeed("ok"))
          yield* buildCiGitStep(failingCommitGitOps)
          // This span should never be reached
          yield* withSpan("check.run", { "check.name": "unreachable" }, Effect.succeed("nope"))
        }).pipe(Effect.provide(successEngineLayer)),
      ),
    )

    const exit = await Effect.runPromiseExit(pipeline)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const traceId = taskSpan.spanContext().traceId

    // agent.execute and git.commit were entered before failure
    const agentSpan = spanByName("agent.execute")!
    const commitSpan = spanByName("git.commit")!
    expect(agentSpan.spanContext().traceId).toBe(traceId)
    expect(commitSpan.spanContext().traceId).toBe(traceId)
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpan.spanContext().spanId)
    expect(parentSpanIdOf(commitSpan)).toBe(loopSpan.spanContext().spanId)

    // Unreachable spans were never emitted
    expect(spanByName("check.run")).toBeUndefined()
    // git.push was never reached because git.commit failed with FatalError
    expect(spanByName("git.push")).toBeUndefined()
    expect(spanByName("git.wait_ci")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Retry failures preserve multiple attempt spans under one trace
// ---------------------------------------------------------------------------

describe("retry failures preserve attempt spans under one trace", () => {
  test("all-attempts-fail produces N attempt spans under task.run", async () => {
    const maxAttempts = 3
    let callCount = 0

    const workflow = withSpan(
      "task.run",
      { engine: "claude" },
      loop(
        () => {
          callCount++
          return pipe(
            withSpan("agent.execute", undefined, Effect.succeed("code")),
            Effect.andThen(
              withSpan(
                "check.run",
                { "check.name": "echo test" },
                Effect.fail(
                  new CheckFailure({
                    command: "echo test",
                    stderr: `fail attempt ${callCount}`,
                    exitCode: 1,
                  }),
                ),
              ),
            ),
          )
        },
        { maxAttempts, spanAttributes: { engine: "claude" } },
      ),
    )

    const exit = await Effect.runPromiseExit(workflow)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const traceId = taskSpan.spanContext().traceId
    const taskSpanId = taskSpan.spanContext().spanId

    // All attempt spans present and under task.run
    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(maxAttempts)
    for (const attempt of attempts) {
      expect(attempt.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(attempt)).toBe(taskSpanId)
    }

    // Each attempt has distinct span IDs
    const attemptSpanIds = attempts.map((a) => a.spanContext().spanId)
    expect(new Set(attemptSpanIds).size).toBe(maxAttempts)

    // Every span in the trace shares the same trace ID
    for (const span of allSpans()) {
      expect(span.spanContext().traceId).toBe(traceId)
    }

    // Step spans (agent, check) are children of some loop.attempt
    const attemptIdSet = new Set(attemptSpanIds)
    for (const span of [...spansByName("agent.execute"), ...spansByName("check.run")]) {
      expect(attemptIdSet.has(parentSpanIdOf(span)!)).toBe(true)
    }
  })

  test("retry with first attempt failing and second succeeding preserves both attempt trees", async () => {
    let callCount = 0

    const workflow = withSpan(
      "task.run",
      { engine: "claude" },
      loop(
        () => {
          callCount++
          if (callCount === 1) {
            return pipe(
              withSpan("agent.execute", undefined, Effect.succeed("code")),
              Effect.andThen(
                withSpan(
                  "check.run",
                  { "check.name": "echo test" },
                  Effect.fail(
                    new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
                  ),
                ),
              ),
            )
          }
          return pipe(
            withSpan("agent.execute", undefined, Effect.succeed("code")),
            Effect.andThen(
              withSpan(
                "check.run",
                { "check.name": "echo test" },
                Effect.succeed("pass"),
              ),
            ),
            Effect.andThen(
              withSpan("report.verify", undefined, Effect.succeed("verified")),
            ),
          )
        },
        { maxAttempts: 2, spanAttributes: { engine: "claude" } },
      ),
    )

    await Effect.runPromise(workflow)

    const taskSpan = spanByName("task.run")!
    const traceId = taskSpan.spanContext().traceId
    const taskSpanId = taskSpan.spanContext().spanId

    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(2)
    expect(attempts[0]!.attributes["loop.attempt"]).toBe(1)
    expect(attempts[1]!.attributes["loop.attempt"]).toBe(2)

    // Both under task.run, same trace
    for (const attempt of attempts) {
      expect(attempt.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(attempt)).toBe(taskSpanId)
    }

    // 2 agent.execute spans, 2 check.run spans, 1 report.verify
    expect(spansByName("agent.execute")).toHaveLength(2)
    expect(spansByName("check.run")).toHaveLength(2)
    expect(spansByName("report.verify")).toHaveLength(1)

    // All spans in the trace share one trace ID
    for (const span of allSpans()) {
      expect(span.spanContext().traceId).toBe(traceId)
    }
  })

  test("retry with CI failure in first attempt and success in second attempt", async () => {
    let callCount = 0

    const workflow = withSpan(
      "task.run",
      { engine: "claude" },
      loop(
        () => {
          callCount++
          return Effect.gen(function* () {
            yield* withSpan("agent.execute", undefined, Effect.succeed("code"))
            yield* withSpan(
              "check.run",
              { "check.name": "echo test" },
              Effect.succeed("pass"),
            )
            if (callCount === 1) {
              yield* buildCiGitStep(failingCiGitOps)
            } else {
              yield* buildCiGitStep(successGitOps)
            }
          })
        },
        { maxAttempts: 2, spanAttributes: { engine: "claude" } },
      ),
    )

    await Effect.runPromise(Effect.provide(workflow, successEngineLayer))

    const taskSpan = spanByName("task.run")!
    const traceId = taskSpan.spanContext().traceId

    // Two attempts
    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(2)

    // All spans share the same trace
    for (const span of allSpans()) {
      expect(span.spanContext().traceId).toBe(traceId)
    }

    // No disconnected root spans
    for (const span of allSpans()) {
      if (span.name === "task.run") {
        expect(parentSpanIdOf(span)).toBeUndefined()
      } else {
        expect(parentSpanIdOf(span)).toBeDefined()
      }
    }

    // git spans from both attempts are children of their respective loop.attempt
    const attemptSpanIds = new Set(attempts.map((a) => a.spanContext().spanId))
    for (const name of ["git.commit", "git.push", "git.wait_ci"]) {
      for (const span of spansByName(name)) {
        expect(attemptSpanIds.has(parentSpanIdOf(span)!)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Telemetry remains fail-open under failure-path hierarchy scenarios
// ---------------------------------------------------------------------------

describe("fail-open under failure-path hierarchy", () => {
  test("broken tracer with failing effect still propagates the effect error", async () => {
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    trace.disable()

    const fakeTracer = {
      startSpan: () => { throw new Error("tracer broken") },
      startActiveSpan: () => { throw new Error("tracer broken") },
    }
    const fakeProvider = { getTracer: () => fakeTracer }
    traceApi.setGlobalTracerProvider(fakeProvider as any)

    try {
      const exit = await Effect.runPromiseExit(
        withSpan(
          "task.run",
          { engine: "claude" },
          withSpan(
            "loop.attempt",
            { "loop.attempt": 1 },
            withSpan(
              "agent.execute",
              undefined,
              Effect.fail(new FatalError({ command: "agent", message: "crash" })),
            ),
          ),
        ),
      )

      // The underlying effect error must propagate even though tracing is broken
      expect(exit._tag).toBe("Failure")
    } finally {
      traceApi.disable()
    }
  })

  test("broken span.end with failing effect still propagates the effect error", async () => {
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    trace.disable()

    const fakeSpan = {
      end: () => { throw new Error("end failed") },
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
      const exit = await Effect.runPromiseExit(
        withSpan(
          "task.run",
          { engine: "claude" },
          withSpan(
            "loop.attempt",
            { "loop.attempt": 1 },
            Effect.fail(new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 })),
          ),
        ),
      )

      // Effect failure propagates despite span.end and span.setStatus throwing
      expect(exit._tag).toBe("Failure")
    } finally {
      traceApi.disable()
    }
  })

  test("broken tracer with successful effect still returns the value", async () => {
    const { trace: traceApi } = require("@opentelemetry/api") as typeof import("@opentelemetry/api")
    trace.disable()

    const fakeTracer = {
      startSpan: () => { throw new Error("tracer broken") },
      startActiveSpan: () => { throw new Error("tracer broken") },
    }
    const fakeProvider = { getTracer: () => fakeTracer }
    traceApi.setGlobalTracerProvider(fakeProvider as any)

    try {
      const result = await Effect.runPromise(
        withSpan(
          "task.run",
          { engine: "claude" },
          withSpan(
            "loop.attempt",
            { "loop.attempt": 1 },
            withSpan("agent.execute", undefined, Effect.succeed("done")),
          ),
        ),
      )

      expect(result).toBe("done")
    } finally {
      traceApi.disable()
    }
  })

  test("span status is set to ERROR for failed attempts in a healthy tracer", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        withSpan(
          "check.run",
          { "check.name": "echo test" },
          Effect.fail(
            new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
          ),
        ),
      ),
    )

    await Effect.runPromiseExit(pipeline)

    const checkSpan = spanByName("check.run")!
    const loopSpan = spanByName("loop.attempt")!
    const taskSpan = spanByName("task.run")!

    // The failing span and its ancestors should record ERROR status
    expect(checkSpan.status.code).toBe(SpanStatusCode.ERROR)
    expect(loopSpan.status.code).toBe(SpanStatusCode.ERROR)
    expect(taskSpan.status.code).toBe(SpanStatusCode.ERROR)
  })
})

// ---------------------------------------------------------------------------
// Edge cases: partial pipelines and empty attempts
// ---------------------------------------------------------------------------

describe("partial pipeline edge cases", () => {
  test("attempt with only agent.execute (no checks) that fails preserves hierarchy", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        withSpan(
          "agent.execute",
          undefined,
          Effect.fail(new FatalError({ command: "agent", message: "timeout" })),
        ),
      ),
    )

    const exit = await Effect.runPromiseExit(pipeline)
    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const agentSpan = spanByName("agent.execute")!

    const traceId = taskSpan.spanContext().traceId
    expect(loopSpan.spanContext().traceId).toBe(traceId)
    expect(agentSpan.spanContext().traceId).toBe(traceId)
    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)
    expect(parentSpanIdOf(agentSpan)).toBe(loopSpan.spanContext().spanId)

    // Only 3 spans emitted (no check, no git)
    expect(allSpans()).toHaveLength(3)
  })

  test("single span failure still completes and exports the span", async () => {
    const exit = await Effect.runPromiseExit(
      withSpan(
        "task.run",
        { engine: "claude" },
        Effect.fail(new FatalError({ command: "init", message: "boom" })),
      ),
    )

    expect(exit._tag).toBe("Failure")

    const taskSpan = spanByName("task.run")!
    expect(taskSpan).toBeDefined()
    expect(taskSpan.status.code).toBe(SpanStatusCode.ERROR)
    expect(parentSpanIdOf(taskSpan)).toBeUndefined()
    expect(allSpans()).toHaveLength(1)
  })

  test("multiple sequential failures across attempts do not leak spans across traces", async () => {
    // Run two separate task.run invocations, each with failures
    const runFailingTask = () =>
      Effect.runPromiseExit(
        withSpan(
          "task.run",
          { engine: "claude" },
          withSpan(
            "loop.attempt",
            { "loop.attempt": 1 },
            Effect.fail(new FatalError({ command: "test", message: "fail" })),
          ),
        ),
      )

    await runFailingTask()
    await runFailingTask()

    const taskSpans = spansByName("task.run")
    expect(taskSpans).toHaveLength(2)

    // Two distinct traces
    const traceId1 = taskSpans[0]!.spanContext().traceId
    const traceId2 = taskSpans[1]!.spanContext().traceId
    expect(traceId1).not.toBe(traceId2)

    // Each loop.attempt belongs to its own task.run's trace
    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(2)
    const attemptTraceIds = new Set(attempts.map((a) => a.spanContext().traceId))
    expect(attemptTraceIds.size).toBe(2)
    expect(attemptTraceIds.has(traceId1)).toBe(true)
    expect(attemptTraceIds.has(traceId2)).toBe(true)
  })
})
