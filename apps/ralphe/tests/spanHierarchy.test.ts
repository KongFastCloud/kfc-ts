/**
 * ABOUTME: Tests that the full span hierarchy (task.run → loop.attempt →
 * agent.execute / check.run / report.verify / git.*) is produced by the
 * orchestration layer. Uses an in-memory exporter so no live Axiom access
 * is required.
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
import { type GitOps, buildCiGitStep } from "../src/runTask.js"
import { loop } from "../src/loop.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"

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

const spanAttrs = (name: string) =>
  exporter.getFinishedSpans().filter((s) => s.name === name).map((s) => s.attributes)

// ---------------------------------------------------------------------------
// Engine layers for tests
// ---------------------------------------------------------------------------

const successEngineLayer = Layer.succeed(Engine, {
  execute: () => Effect.succeed({ response: "ok" } satisfies AgentResult),
})

const failEngineLayer = Layer.succeed(Engine, {
  execute: () =>
    Effect.fail(
      new FatalError({ command: "agent", message: "agent crash" }),
    ),
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

// ---------------------------------------------------------------------------
// task.run span boundary
// ---------------------------------------------------------------------------

describe("task.run span", () => {
  test("produces a task.run span wrapping the pipeline", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.provide(
        withSpan("agent.execute", undefined, agent("test")),
        successEngineLayer,
      ),
    )
    await Effect.runPromise(pipeline)

    expect(spanNames()).toContain("task.run")
  })

  test("task.run span carries engine attribute", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.succeed("ok"),
    )
    await Effect.runPromise(pipeline)

    const attrs = spanAttrs("task.run")
    expect(attrs).toHaveLength(1)
    expect(attrs[0]!["engine"]).toBe("claude")
  })

  test("task.run span carries issue.id when present", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "codex", "issue.id": "TST-42" },
      Effect.succeed("ok"),
    )
    await Effect.runPromise(pipeline)

    const attrs = spanAttrs("task.run")
    expect(attrs).toHaveLength(1)
    expect(attrs[0]!["engine"]).toBe("codex")
    expect(attrs[0]!["issue.id"]).toBe("TST-42")
  })

  test("task.run span is created even when inner effect fails", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.fail(new FatalError({ command: "agent", message: "crash" })),
    )
    const exit = await Effect.runPromiseExit(pipeline)

    expect(exit._tag).toBe("Failure")
    expect(spanNames()).toContain("task.run")
  })
})

// ---------------------------------------------------------------------------
// Full span hierarchy
// ---------------------------------------------------------------------------

describe("span hierarchy", () => {
  test("single attempt produces task.run → loop.attempt → agent.execute → check.run", async () => {
    const attemptBody = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, agent("test"))
      yield* withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))
      yield* withSpan("check.run", { "check.name": "echo test" }, cmd("echo test"))
    })

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(attemptBody, successEngineLayer),
      ),
    )
    await Effect.runPromise(pipeline)

    const names = spanNames()
    expect(names).toContain("task.run")
    expect(names).toContain("loop.attempt")
    expect(names).toContain("agent.execute")
    expect(names.filter((n) => n === "check.run")).toHaveLength(2)
  })

  test("retry produces two loop.attempt spans with incrementing attempt numbers", async () => {
    let attemptCalls = 0
    const workflow = loop(
      () => {
        attemptCalls++
        if (attemptCalls === 1) {
          return Effect.fail(
            new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 }),
          )
        }
        return Effect.succeed("ok")
      },
      {
        maxAttempts: 2,
        spanAttributes: { engine: "claude" },
      },
    )

    await Effect.runPromise(workflow)

    const attemptSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "loop.attempt")
    expect(attemptSpans).toHaveLength(2)
    expect(attemptSpans[0]!.attributes["loop.attempt"]).toBe(1)
    expect(attemptSpans[1]!.attributes["loop.attempt"]).toBe(2)
  })

  test("all agreed span names are emitted for a full pipeline with git", async () => {
    const pipeline = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, Effect.succeed("ok"))
      yield* withSpan("check.run", { "check.name": "echo test" }, Effect.succeed("ok"))
      yield* buildCiGitStep(successGitOps)
    })

    const wrappedPipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(pipeline, successEngineLayer),
      ),
    )

    await Effect.runPromise(wrappedPipeline)

    const names = spanNames()
    // All agreed span boundaries present
    expect(names).toContain("task.run")
    expect(names).toContain("loop.attempt")
    expect(names).toContain("agent.execute")
    expect(names).toContain("check.run")
    expect(names).toContain("git.commit")
    expect(names).toContain("git.push")
    expect(names).toContain("git.wait_ci")
  })

  test("no span names outside the agreed set appear", async () => {
    const pipeline = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, Effect.succeed("ok"))
      yield* withSpan("check.run", { "check.name": "echo test" }, Effect.succeed("ok"))
    })

    const wrappedPipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        pipeline,
      ),
    )

    await Effect.runPromise(wrappedPipeline)

    const agreed = new Set([
      "task.run",
      "loop.attempt",
      "agent.execute",
      "check.run",
      "report.verify",
      "git.commit",
      "git.push",
      "git.wait_ci",
    ])
    for (const name of spanNames()) {
      expect(agreed.has(name)).toBe(true)
    }
  })
})
