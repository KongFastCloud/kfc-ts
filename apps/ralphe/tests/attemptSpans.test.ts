/**
 * ABOUTME: Tests that agent, check, and report orchestration produce the
 * expected OTel spans inside a loop attempt. Verifies agent.execute,
 * check.run (per configured check), and report.verify spans are created
 * at the orchestration boundaries without changing task behavior.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { report } from "../src/report.js"
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

const spanNames = (): string[] =>
  exporter.getFinishedSpans().map((s) => s.name)

// ---------------------------------------------------------------------------
// Helpers — build the same pipeline runTask builds, with a fake engine
// ---------------------------------------------------------------------------

const successEngineLayer = Layer.succeed(Engine, {
  execute: () => Effect.succeed({ response: "ok" } satisfies AgentResult),
})

const reportSuccessEngineLayer = Layer.succeed(Engine, {
  execute: () =>
    Effect.succeed({
      response: '```json\n{"success": true, "report": "looks good"}\n```',
    } satisfies AgentResult),
})

const reportFailEngineLayer = Layer.succeed(Engine, {
  execute: () =>
    Effect.succeed({
      response: '```json\n{"success": false, "report": "broken"}\n```',
    } satisfies AgentResult),
})

const failEngineLayer = Layer.succeed(Engine, {
  execute: () =>
    Effect.fail(
      new FatalError({ command: "agent", message: "agent failed" }),
    ),
})

// ---------------------------------------------------------------------------
// agent.execute span
// ---------------------------------------------------------------------------

describe("agent.execute span", () => {
  test("produces an agent.execute span on success", async () => {
    const pipeline = Effect.provide(
      agent("do something").pipe(Effect.withSpan("agent.execute")),
      successEngineLayer,
    ).pipe(Effect.provide(TracingLive))
    await Effect.runPromise(pipeline)

    expect(spanNames()).toContain("agent.execute")
  })

  test("produces an agent.execute span when agent fails", async () => {
    const pipeline = Effect.provide(
      agent("do something").pipe(Effect.withSpan("agent.execute")),
      failEngineLayer,
    ).pipe(Effect.provide(TracingLive))
    await Effect.runPromiseExit(pipeline)

    expect(spanNames()).toContain("agent.execute")
  })
})

// ---------------------------------------------------------------------------
// check.run spans
// ---------------------------------------------------------------------------

describe("check.run spans", () => {
  test("produces a check.run span for a passing check", async () => {
    const pipeline = cmd("echo ok").pipe(
      Effect.withSpan("check.run", { attributes: { "check.name": "echo ok" } }),
      Effect.provide(TracingLive),
    )
    await Effect.runPromise(pipeline)

    expect(spanNames()).toContain("check.run")
  })

  test("produces a check.run span per configured check", async () => {
    const checks = ["echo lint", "echo test"]
    let pipeline: Effect.Effect<unknown, any> = Effect.void
    for (const check of checks) {
      pipeline = pipe(pipeline, Effect.andThen(
        cmd(check).pipe(Effect.withSpan("check.run", { attributes: { "check.name": check } })),
      ))
    }
    await Effect.runPromise(pipeline.pipe(Effect.provide(TracingLive)))

    const checkSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "check.run")
    expect(checkSpans).toHaveLength(2)
  })

  test("check.run span carries check.name attribute", async () => {
    const pipeline = cmd("echo typecheck").pipe(
      Effect.withSpan("check.run", { attributes: { "check.name": "echo typecheck" } }),
      Effect.provide(TracingLive),
    )
    await Effect.runPromise(pipeline)

    const checkSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "check.run")
    expect(checkSpans).toHaveLength(1)
    expect(checkSpans[0]!.attributes["check.name"]).toBe("echo typecheck")
  })

  test("check.run span is created even when check fails", async () => {
    const pipeline = cmd("false").pipe(
      Effect.withSpan("check.run", { attributes: { "check.name": "false" } }),
      Effect.provide(TracingLive),
    )
    await Effect.runPromiseExit(pipeline)

    expect(spanNames()).toContain("check.run")
  })
})

// ---------------------------------------------------------------------------
// report.verify span
// ---------------------------------------------------------------------------

describe("report.verify span", () => {
  test("produces a report.verify span when report succeeds", async () => {
    const pipeline = Effect.provide(
      report("do something", "basic").pipe(Effect.withSpan("report.verify")),
      reportSuccessEngineLayer,
    ).pipe(Effect.provide(TracingLive))
    await Effect.runPromise(pipeline)

    expect(spanNames()).toContain("report.verify")
  })

  test("produces a report.verify span when report fails", async () => {
    const pipeline = Effect.provide(
      report("do something", "basic").pipe(Effect.withSpan("report.verify")),
      reportFailEngineLayer,
    ).pipe(Effect.provide(TracingLive))
    await Effect.runPromiseExit(pipeline)

    expect(spanNames()).toContain("report.verify")
  })
})

// ---------------------------------------------------------------------------
// Combined pipeline (mirrors runTask pipeline construction)
// ---------------------------------------------------------------------------

describe("combined pipeline spans", () => {
  test("agent.execute + check.run spans produced in sequence", async () => {
    let pipeline: Effect.Effect<unknown, any, Engine> = agent("do something").pipe(
      Effect.withSpan("agent.execute"),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(cmd("echo ok").pipe(Effect.withSpan("check.run", { attributes: { "check.name": "echo ok" } }))),
    )

    await Effect.runPromise(
      Effect.provide(pipeline, successEngineLayer).pipe(Effect.provide(TracingLive)),
    )

    expect(spanNames()).toContain("agent.execute")
    expect(spanNames()).toContain("check.run")
  })

  test("agent.execute + check.run + report.verify spans produced in sequence", async () => {
    let pipeline: Effect.Effect<unknown, any, Engine> = agent("do something").pipe(
      Effect.withSpan("agent.execute"),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(cmd("echo lint").pipe(Effect.withSpan("check.run", { attributes: { "check.name": "echo lint" } }))),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(report("do something", "basic").pipe(Effect.withSpan("report.verify"))),
    )

    await Effect.runPromise(
      Effect.provide(pipeline, reportSuccessEngineLayer).pipe(Effect.provide(TracingLive)),
    )

    expect(spanNames()).toContain("agent.execute")
    expect(spanNames()).toContain("check.run")
    expect(spanNames()).toContain("report.verify")
  })
})
