/**
 * ABOUTME: Tests that nested step spans (agent.execute, check.run, report.verify,
 * git.*) inherit the active parent context and appear beneath the correct enclosing
 * span. Validates trace IDs and parent span IDs so regressions to disconnected
 * root spans are caught. Uses in-memory exporters only — no live Axiom access.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { withSpan } from "../src/telemetry.js"
import { buildCiGitStep, executePostLoopGitOps, type GitOps } from "../src/runTask.js"
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
// Fake layers and git ops
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

const noCommitGitOps: GitOps = {
  ...successGitOps,
  commit: () => Effect.succeed(undefined),
}

// ---------------------------------------------------------------------------
// git spans inherit parent context inside loop.attempt
// ---------------------------------------------------------------------------

describe("git spans inherit parent context", () => {
  test("git.commit, git.push, git.wait_ci are children of loop.attempt", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(buildCiGitStep(successGitOps), successEngineLayer),
      ),
    )

    await Effect.runPromise(pipeline)

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const commitSpan = spanByName("git.commit")!
    const pushSpan = spanByName("git.push")!
    const waitCiSpan = spanByName("git.wait_ci")!

    const traceId = taskSpan.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    // All git spans share the same trace ID as the task root
    expect(commitSpan.spanContext().traceId).toBe(traceId)
    expect(pushSpan.spanContext().traceId).toBe(traceId)
    expect(waitCiSpan.spanContext().traceId).toBe(traceId)

    // All git spans are children of loop.attempt
    expect(parentSpanIdOf(commitSpan)).toBe(loopSpanId)
    expect(parentSpanIdOf(pushSpan)).toBe(loopSpanId)
    expect(parentSpanIdOf(waitCiSpan)).toBe(loopSpanId)
  })

  test("post-loop git.commit is child of enclosing span", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.provide(
        executePostLoopGitOps("commit", successGitOps),
        successEngineLayer,
      ),
    )

    await Effect.runPromise(pipeline)

    const taskSpan = spanByName("task.run")!
    const commitSpan = spanByName("git.commit")!

    expect(commitSpan.spanContext().traceId).toBe(taskSpan.spanContext().traceId)
    expect(parentSpanIdOf(commitSpan)).toBe(taskSpan.spanContext().spanId)
  })

  test("post-loop git.commit and git.push are children of enclosing span", async () => {
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.provide(
        executePostLoopGitOps("commit_and_push", successGitOps),
        successEngineLayer,
      ),
    )

    await Effect.runPromise(pipeline)

    const taskSpan = spanByName("task.run")!
    const commitSpan = spanByName("git.commit")!
    const pushSpan = spanByName("git.push")!

    const traceId = taskSpan.spanContext().traceId
    const taskSpanId = taskSpan.spanContext().spanId

    expect(commitSpan.spanContext().traceId).toBe(traceId)
    expect(pushSpan.spanContext().traceId).toBe(traceId)
    expect(parentSpanIdOf(commitSpan)).toBe(taskSpanId)
    expect(parentSpanIdOf(pushSpan)).toBe(taskSpanId)
  })
})

// ---------------------------------------------------------------------------
// Full orchestration hierarchy with git spans
// ---------------------------------------------------------------------------

describe("full orchestration hierarchy with git", () => {
  test("agent.execute, check.run, git spans are all children of loop.attempt", async () => {
    const attemptBody = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, agent("test"))
      yield* withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))
      yield* withSpan("report.verify", undefined, report("test", "basic"))
      yield* buildCiGitStep(successGitOps)
    })

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(attemptBody, reportSuccessEngineLayer),
      ),
    )

    await Effect.runPromise(pipeline)

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!

    const traceId = taskSpan.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    // loop.attempt is child of task.run
    expect(parentSpanIdOf(loopSpan)).toBe(taskSpan.spanContext().spanId)

    // Every step span is a child of loop.attempt and shares the trace ID
    const stepSpanNames = [
      "agent.execute",
      "check.run",
      "report.verify",
      "git.commit",
      "git.push",
      "git.wait_ci",
    ]
    for (const name of stepSpanNames) {
      const span = spanByName(name)
      expect(span).toBeDefined()
      expect(span!.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(span!)).toBe(loopSpanId)
    }
  })

  test("multiple check.run spans are all children of the same loop.attempt", async () => {
    const attemptBody = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, agent("test"))
      yield* withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))
      yield* withSpan("check.run", { "check.name": "echo test" }, cmd("echo test"))
      yield* withSpan("check.run", { "check.name": "echo typecheck" }, cmd("echo typecheck"))
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

    const loopSpan = spanByName("loop.attempt")!
    const traceId = spanByName("task.run")!.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    const checkSpans = spansByName("check.run")
    expect(checkSpans).toHaveLength(3)

    for (const checkSpan of checkSpans) {
      expect(checkSpan.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(checkSpan)).toBe(loopSpanId)
    }
  })
})

// ---------------------------------------------------------------------------
// Regression guard: no disconnected root spans
// ---------------------------------------------------------------------------

describe("no disconnected root spans", () => {
  test("all step spans in a task share a single trace ID", async () => {
    const attemptBody = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, agent("test"))
      yield* withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))
      yield* withSpan("report.verify", undefined, report("test", "basic"))
      yield* buildCiGitStep(successGitOps)
    })

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(attemptBody, reportSuccessEngineLayer),
      ),
    )

    await Effect.runPromise(pipeline)

    const spans = allSpans()
    expect(spans.length).toBeGreaterThanOrEqual(8) // task, loop, agent, check, report, git×3

    const traceId = spanByName("task.run")!.spanContext().traceId
    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(traceId)
    }
  })

  test("no step span is a root span except task.run", async () => {
    const attemptBody = Effect.gen(function* () {
      yield* withSpan("agent.execute", undefined, agent("test"))
      yield* withSpan("check.run", { "check.name": "echo lint" }, cmd("echo lint"))
      yield* withSpan("report.verify", undefined, report("test", "basic"))
    })

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(attemptBody, reportSuccessEngineLayer),
      ),
    )

    await Effect.runPromise(pipeline)

    const spans = allSpans()
    for (const span of spans) {
      if (span.name === "task.run") {
        // task.run should be the only root span
        expect(parentSpanIdOf(span)).toBeUndefined()
      } else {
        // Every other span must have a parent
        expect(parentSpanIdOf(span)).toBeDefined()
      }
    }
  })

  test("retry attempts each produce correctly nested step spans", async () => {
    let callCount = 0

    const attemptFn = () => {
      callCount++
      if (callCount === 1) {
        return pipe(
          withSpan("agent.execute", undefined, Effect.succeed("code")),
          Effect.andThen(
            withSpan("check.run", { "check.name": "echo test" },
              Effect.fail(new CheckFailure({ command: "echo test", stderr: "fail", exitCode: 1 })),
            ),
          ),
        )
      }
      return pipe(
        withSpan("agent.execute", undefined, Effect.succeed("code")),
        Effect.andThen(
          withSpan("check.run", { "check.name": "echo test" }, Effect.succeed("pass")),
        ),
        Effect.andThen(
          withSpan("report.verify", undefined, Effect.succeed("verified")),
        ),
      )
    }

    // Wrap in task.run to simulate full hierarchy
    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      Effect.gen(function* () {
        // Attempt 1: fails at check
        const a1 = yield* Effect.exit(
          withSpan("loop.attempt", { "loop.attempt": 1, "loop.max_attempts": 2, engine: "claude" },
            attemptFn(),
          ),
        )
        // Attempt 2: succeeds
        yield* withSpan("loop.attempt", { "loop.attempt": 2, "loop.max_attempts": 2, engine: "claude" },
          attemptFn(),
        )
      }),
    )

    await Effect.runPromise(pipeline)

    const taskSpan = spanByName("task.run")!
    const traceId = taskSpan.spanContext().traceId

    // All spans share the same trace ID
    for (const span of allSpans()) {
      expect(span.spanContext().traceId).toBe(traceId)
    }

    // Both loop.attempt spans are children of task.run
    const attempts = spansByName("loop.attempt")
    expect(attempts).toHaveLength(2)
    for (const attempt of attempts) {
      expect(parentSpanIdOf(attempt)).toBe(taskSpan.spanContext().spanId)
    }

    // Each agent.execute and check.run is a child of some loop.attempt
    const attemptSpanIds = new Set(attempts.map((a) => a.spanContext().spanId))
    const agentSpans = spansByName("agent.execute")
    const checkSpans = spansByName("check.run")

    expect(agentSpans).toHaveLength(2)
    expect(checkSpans).toHaveLength(2)

    for (const span of [...agentSpans, ...checkSpans]) {
      expect(attemptSpanIds.has(parentSpanIdOf(span)!)).toBe(true)
    }

    // report.verify only in attempt 2, should also be child of a loop.attempt
    const reportSpans = spansByName("report.verify")
    expect(reportSpans).toHaveLength(1)
    expect(attemptSpanIds.has(parentSpanIdOf(reportSpans[0]!)!)).toBe(true)
  })

  test("git spans inside failed attempt still have correct parent", async () => {
    const failingCiOps: GitOps = {
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

    const pipeline = withSpan(
      "task.run",
      { engine: "claude" },
      withSpan(
        "loop.attempt",
        { "loop.attempt": 1, "loop.max_attempts": 1, engine: "claude" },
        Effect.provide(buildCiGitStep(failingCiOps), successEngineLayer),
      ),
    )

    await Effect.runPromiseExit(pipeline)

    const taskSpan = spanByName("task.run")!
    const loopSpan = spanByName("loop.attempt")!
    const traceId = taskSpan.spanContext().traceId
    const loopSpanId = loopSpan.spanContext().spanId

    // git.commit and git.push should still be children of loop.attempt
    const commitSpan = spanByName("git.commit")!
    const pushSpan = spanByName("git.push")!
    const waitCiSpan = spanByName("git.wait_ci")!

    for (const span of [commitSpan, pushSpan, waitCiSpan]) {
      expect(span.spanContext().traceId).toBe(traceId)
      expect(parentSpanIdOf(span)).toBe(loopSpanId)
    }
  })
})
