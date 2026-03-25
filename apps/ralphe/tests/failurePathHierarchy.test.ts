/**
 * ABOUTME: Tests that failure-path scenarios preserve the expected trace hierarchy.
 * Covers failed attempts with nested step failures, retry sequences that ultimately
 * fail, partial pipelines that abort midway, and fail-open telemetry under hierarchy
 * failure conditions. All tests are deterministic and use in-memory exporters only —
 * no live Axiom access is required.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { SpanStatusCode, trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { type GitOps, buildCiGitStep } from "../src/runTask.js"
import { loop } from "../src/loop.js"
import { TracingLive } from "../src/telemetry.js"

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
    const pipeline = Effect.fail(new FatalError({ command: "agent", message: "crash" })).pipe(
      Effect.withSpan("agent.execute"),
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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
      Effect.succeed("code generated").pipe(Effect.withSpan("agent.execute")),
      Effect.andThen(
        Effect.fail(
          new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
        ).pipe(Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } })),
      ),
    )

    const pipeline = attemptBody.pipe(
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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
    const pipeline = Effect.gen(function* () {
      yield* Effect.succeed("ok").pipe(Effect.withSpan("agent.execute"))
      yield* Effect.succeed("pass").pipe(
        Effect.withSpan("check.run", { attributes: { "check.name": "echo lint" } }),
      )
      yield* buildCiGitStep(failingCiGitOps)
    }).pipe(
      Effect.provide(successEngineLayer),
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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
    const pipeline = Effect.gen(function* () {
      yield* Effect.succeed("ok").pipe(Effect.withSpan("agent.execute"))
      yield* buildCiGitStep(failingCommitGitOps)
      // This span should never be reached
      yield* Effect.succeed("nope").pipe(
        Effect.withSpan("check.run", { attributes: { "check.name": "unreachable" } }),
      )
    }).pipe(
      Effect.provide(successEngineLayer),
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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

    const workflow = loop(
      () => {
        callCount++
        return pipe(
          Effect.succeed("code").pipe(Effect.withSpan("agent.execute")),
          Effect.andThen(
            Effect.fail(
              new CheckFailure({
                command: "echo test",
                stderr: `fail attempt ${callCount}`,
                exitCode: 1,
              }),
            ).pipe(Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } })),
          ),
        )
      },
      { maxAttempts, spanAttributes: { engine: "claude" } },
    ).pipe(
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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

    const workflow = loop(
      () => {
        callCount++
        if (callCount === 1) {
          return pipe(
            Effect.succeed("code").pipe(Effect.withSpan("agent.execute")),
            Effect.andThen(
              Effect.fail(
                new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
              ).pipe(Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } })),
            ),
          )
        }
        return pipe(
          Effect.succeed("code").pipe(Effect.withSpan("agent.execute")),
          Effect.andThen(
            Effect.succeed("pass").pipe(
              Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } }),
            ),
          ),
          Effect.andThen(
            Effect.succeed("verified").pipe(Effect.withSpan("report.verify")),
          ),
        )
      },
      { maxAttempts: 2, spanAttributes: { engine: "claude" } },
    ).pipe(
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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

    const workflow = loop(
      () => {
        callCount++
        return Effect.gen(function* () {
          yield* Effect.succeed("code").pipe(Effect.withSpan("agent.execute"))
          yield* Effect.succeed("pass").pipe(
            Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } }),
          )
          if (callCount === 1) {
            yield* buildCiGitStep(failingCiGitOps)
          } else {
            yield* buildCiGitStep(successGitOps)
          }
        })
      },
      { maxAttempts: 2, spanAttributes: { engine: "claude" } },
    ).pipe(
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(Layer.merge(successEngineLayer, TracingLive)),
    )

    await Effect.runPromise(workflow)

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
// Fail-open: effects propagate correctly even without tracing layer
// ---------------------------------------------------------------------------

describe("fail-open under failure paths", () => {
  test("failing effect propagates error without tracing layer", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail(new FatalError({ command: "agent", message: "crash" })).pipe(
        Effect.withSpan("agent.execute"),
        Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1 } }),
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("successful effect returns value without tracing layer", async () => {
    const result = await Effect.runPromise(
      Effect.succeed("done").pipe(
        Effect.withSpan("agent.execute"),
        Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1 } }),
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      ),
    )
    expect(result).toBe("done")
  })
})

// ---------------------------------------------------------------------------
// Error status on failure spans
// ---------------------------------------------------------------------------

describe("span error status", () => {
  test("span status is set to ERROR for failed effects", async () => {
    const pipeline = Effect.fail(
      new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 }),
    ).pipe(
      Effect.withSpan("check.run", { attributes: { "check.name": "echo test" } }),
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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
    const pipeline = Effect.fail(new FatalError({ command: "agent", message: "timeout" })).pipe(
      Effect.withSpan("agent.execute"),
      Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" } }),
      Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
      Effect.provide(TracingLive),
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
      Effect.fail(new FatalError({ command: "init", message: "boom" })).pipe(
        Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
        Effect.provide(TracingLive),
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
        Effect.fail(new FatalError({ command: "test", message: "fail" })).pipe(
          Effect.withSpan("loop.attempt", { attributes: { "loop.attempt": 1 } }),
          Effect.withSpan("task.run", { attributes: { engine: "claude" } }),
          Effect.provide(TracingLive),
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
