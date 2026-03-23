/**
 * ABOUTME: Tests that agent, check, and report orchestration produce the
 * expected OTel spans inside a loop attempt. Verifies agent.execute,
 * check.run (per configured check), and report.verify spans are created
 * at the orchestration boundaries without changing task behavior.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { withSpan } from "../src/telemetry.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { report } from "../src/report.js"

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
    const pipeline = withSpan("agent.execute", undefined, agent("do something"))
    await Effect.runPromise(Effect.provide(pipeline, successEngineLayer))

    expect(spanNames()).toContain("agent.execute")
  })

  test("produces an agent.execute span when agent fails", async () => {
    const pipeline = withSpan("agent.execute", undefined, agent("do something"))
    await Effect.runPromiseExit(Effect.provide(pipeline, failEngineLayer))

    expect(spanNames()).toContain("agent.execute")
  })
})

// ---------------------------------------------------------------------------
// check.run spans
// ---------------------------------------------------------------------------

describe("check.run spans", () => {
  test("produces a check.run span for a passing check", async () => {
    const pipeline = withSpan("check.run", { "check.name": "echo ok" }, cmd("echo ok"))
    await Effect.runPromise(pipeline)

    expect(spanNames()).toContain("check.run")
  })

  test("produces a check.run span per configured check", async () => {
    const checks = ["echo lint", "echo test"]
    let pipeline: Effect.Effect<unknown, any> = Effect.void
    for (const check of checks) {
      pipeline = pipe(pipeline, Effect.andThen(withSpan("check.run", { "check.name": check }, cmd(check))))
    }
    await Effect.runPromise(pipeline)

    const checkSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "check.run")
    expect(checkSpans).toHaveLength(2)
  })

  test("check.run span carries check.name attribute", async () => {
    const pipeline = withSpan("check.run", { "check.name": "echo typecheck" }, cmd("echo typecheck"))
    await Effect.runPromise(pipeline)

    const checkSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "check.run")
    expect(checkSpans).toHaveLength(1)
    expect(checkSpans[0]!.attributes["check.name"]).toBe("echo typecheck")
  })

  test("check.run spans do not include command output or stderr", async () => {
    const pipeline = withSpan("check.run", { "check.name": "echo hello" }, cmd("echo hello"))
    await Effect.runPromise(pipeline)

    const checkSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "check.run")
    expect(checkSpans).toHaveLength(1)

    const attrKeys = Object.keys(checkSpans[0]!.attributes)
    expect(attrKeys).toEqual(["check.name"])
  })

  test("check.run span is created even when check fails", async () => {
    const pipeline = withSpan("check.run", { "check.name": "false" }, cmd("false"))
    await Effect.runPromiseExit(pipeline)

    expect(spanNames()).toContain("check.run")
  })
})

// ---------------------------------------------------------------------------
// report.verify span
// ---------------------------------------------------------------------------

describe("report.verify span", () => {
  test("produces a report.verify span when report succeeds", async () => {
    const pipeline = withSpan("report.verify", undefined, report("do something", "basic"))
    await Effect.runPromise(Effect.provide(pipeline, reportSuccessEngineLayer))

    expect(spanNames()).toContain("report.verify")
  })

  test("produces a report.verify span when report fails", async () => {
    const pipeline = withSpan("report.verify", undefined, report("do something", "basic"))
    await Effect.runPromiseExit(Effect.provide(pipeline, reportFailEngineLayer))

    expect(spanNames()).toContain("report.verify")
  })
})

// ---------------------------------------------------------------------------
// Combined pipeline (mirrors runTask pipeline construction)
// ---------------------------------------------------------------------------

describe("combined pipeline spans", () => {
  test("agent.execute + check.run spans produced in sequence", async () => {
    let pipeline: Effect.Effect<unknown, any, Engine> = withSpan(
      "agent.execute",
      undefined,
      agent("do something"),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(withSpan("check.run", { "check.name": "echo ok" }, cmd("echo ok"))),
    )

    await Effect.runPromise(Effect.provide(pipeline, successEngineLayer))

    expect(spanNames()).toContain("agent.execute")
    expect(spanNames()).toContain("check.run")
  })

  test("agent.execute + check.run + report.verify spans produced in sequence", async () => {
    let pipeline: Effect.Effect<unknown, any, Engine> = withSpan(
      "agent.execute",
      undefined,
      agent("do something"),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))),
    )
    pipeline = pipe(
      pipeline,
      Effect.andThen(withSpan("report.verify", undefined, report("do something", "basic"))),
    )

    await Effect.runPromise(Effect.provide(pipeline, reportSuccessEngineLayer))

    expect(spanNames()).toContain("agent.execute")
    expect(spanNames()).toContain("check.run")
    expect(spanNames()).toContain("report.verify")
  })
})
