/**
 * ABOUTME: Tests that git orchestration functions produce the expected OTel spans.
 * Verifies git.commit, git.push, and git.wait_ci spans are created at the
 * orchestration boundaries (buildCiGitStep and executePostLoopGitOps) without
 * changing retry behavior or task outcomes.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { Engine } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { buildCiGitStep, executePostLoopGitOps, type GitOps } from "../src/runTask.js"

// ---------------------------------------------------------------------------
// In-memory span capture
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let provider: BasicTracerProvider

beforeEach(() => {
  // Clear any global provider set by other test files before installing ours
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
// Helpers
// ---------------------------------------------------------------------------

const emptyEngineLayer = Layer.succeed(Engine, {
  execute: () => Effect.succeed({ response: "ok" }),
})

let mockedCommitResult: { message: string; hash: string } | undefined
let commitShouldFail: boolean
let pushShouldFail: boolean
let waitCiShouldFail: boolean

const makeGitOps = (): GitOps => ({
  commit: () =>
    Effect.gen(function* () {
      if (commitShouldFail) {
        return yield* Effect.fail(
          new FatalError({ command: "git commit", message: "commit failed" }),
        )
      }
      return mockedCommitResult
    }),
  push: () =>
    Effect.gen(function* () {
      if (pushShouldFail) {
        return yield* Effect.fail(
          new FatalError({ command: "git push", message: "push failed" }),
        )
      }
      return { remote: "origin", ref: "main", output: "" }
    }),
  waitCi: () =>
    Effect.gen(function* () {
      if (waitCiShouldFail) {
        return yield* Effect.fail(
          new CheckFailure({
            command: "CI run 123",
            stderr: "CI failed",
            exitCode: 1,
          }),
        )
      }
      return {
        runId: 123,
        status: "completed",
        conclusion: "success",
        url: "https://example.com/run/123",
        workflowName: "ci",
      }
    }),
})

beforeEach(() => {
  mockedCommitResult = { message: "feat: test", hash: "abc1234" }
  commitShouldFail = false
  pushShouldFail = false
  waitCiShouldFail = false
})

// ---------------------------------------------------------------------------
// buildCiGitStep spans
// ---------------------------------------------------------------------------

describe("buildCiGitStep spans", () => {
  test("produces git.commit, git.push, and git.wait_ci spans on success", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).toContain("git.push")
    expect(spanNames()).toContain("git.wait_ci")
  })

  test("produces only git.commit span when no changes to commit", async () => {
    mockedCommitResult = undefined
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).not.toContain("git.push")
    expect(spanNames()).not.toContain("git.wait_ci")
  })

  test("produces git.commit and git.push spans when push fails", async () => {
    pushShouldFail = true
    const ops = makeGitOps()
    await Effect.runPromiseExit(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).toContain("git.push")
    expect(spanNames()).not.toContain("git.wait_ci")
  })

  test("produces all three spans when wait_ci fails", async () => {
    waitCiShouldFail = true
    const ops = makeGitOps()
    await Effect.runPromiseExit(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).toContain("git.push")
    expect(spanNames()).toContain("git.wait_ci")
  })
})

// ---------------------------------------------------------------------------
// executePostLoopGitOps spans
// ---------------------------------------------------------------------------

describe("executePostLoopGitOps spans", () => {
  test("none mode produces no git spans", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(executePostLoopGitOps("none", ops), emptyEngineLayer))

    expect(spanNames()).not.toContain("git.commit")
    expect(spanNames()).not.toContain("git.push")
  })

  test("commit mode produces git.commit span", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(executePostLoopGitOps("commit", ops), emptyEngineLayer))

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).not.toContain("git.push")
  })

  test("commit_and_push mode produces git.commit and git.push spans", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(
      Effect.provide(executePostLoopGitOps("commit_and_push", ops), emptyEngineLayer),
    )

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).toContain("git.push")
  })

  test("commit_and_push skips git.push span when no commit", async () => {
    mockedCommitResult = undefined
    const ops = makeGitOps()
    await Effect.runPromise(
      Effect.provide(executePostLoopGitOps("commit_and_push", ops), emptyEngineLayer),
    )

    expect(spanNames()).toContain("git.commit")
    expect(spanNames()).not.toContain("git.push")
  })

  test("commit_and_push_and_wait_ci mode produces no post-loop git spans", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(
      Effect.provide(
        executePostLoopGitOps("commit_and_push_and_wait_ci", ops),
        emptyEngineLayer,
      ),
    )

    expect(spanNames()).not.toContain("git.commit")
    expect(spanNames()).not.toContain("git.push")
    expect(spanNames()).not.toContain("git.wait_ci")
  })
})

// ---------------------------------------------------------------------------
// Span coverage does not change task outcomes
// ---------------------------------------------------------------------------

describe("span coverage preserves task outcomes", () => {
  test("commit failure still propagates through span", async () => {
    commitShouldFail = true
    const ops = makeGitOps()
    const exit = await Effect.runPromiseExit(
      Effect.provide(buildCiGitStep(ops), emptyEngineLayer),
    )

    expect(exit._tag).toBe("Failure")
    expect(spanNames()).toContain("git.commit")
  })

  test("CI failure still propagates through span as CheckFailure", async () => {
    waitCiShouldFail = true
    const ops = makeGitOps()
    const exit = await Effect.runPromiseExit(
      Effect.provide(buildCiGitStep(ops), emptyEngineLayer),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect((exit.cause.error as CheckFailure).stderr).toContain("CI failed")
    }
  })
})
