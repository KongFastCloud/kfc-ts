import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { RalpheConfig } from "../src/config.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { Engine } from "../src/engine/Engine.js"
import {
  resolveGitMode,
  buildCiGitStep,
  executePostLoopGitOps,
  type GitOps,
} from "../src/runTask.js"

let gitCalls: string[] = []
let mockedCommitResult: { message: string; hash: string } | undefined = {
  message: "feat: test commit",
  hash: "abc1234",
}
let commitShouldFail = false
let pushShouldFail = false
let waitCiShouldFail = false

const baseConfig: RalpheConfig = {
  engine: "claude",
  maxAttempts: 1,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

const emptyEngineLayer = Layer.succeed(Engine, {
  execute: () => Effect.succeed({ response: "ok" }),
})

const makeGitOps = (): GitOps => ({
  commit: () =>
    Effect.gen(function* () {
      gitCalls.push("commit")
      if (commitShouldFail) {
        return yield* Effect.fail(
          new FatalError({ command: "git commit", message: "commit failed" }),
        )
      }
      return mockedCommitResult
    }),
  push: () =>
    Effect.gen(function* () {
      gitCalls.push("push")
      if (pushShouldFail) {
        return yield* Effect.fail(
          new FatalError({ command: "git push", message: "push failed" }),
        )
      }
      return { remote: "origin", ref: "main", output: "" }
    }),
  waitCi: () =>
    Effect.gen(function* () {
      gitCalls.push("wait_ci")
      if (waitCiShouldFail) {
        return yield* Effect.fail(
          new CheckFailure({
            command: "CI run 123",
            stderr: "CI failed (run 123). Failure annotations:\n\nError: tests failed",
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
  gitCalls = []
  mockedCommitResult = { message: "feat: test commit", hash: "abc1234" }
  commitShouldFail = false
  pushShouldFail = false
  waitCiShouldFail = false
})

describe("runTask git mode behavior", () => {
  test("none mode executes no git operations", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(executePostLoopGitOps("none", ops), emptyEngineLayer))
    expect(gitCalls).toEqual([])
  })

  test("commit mode executes commit only", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(executePostLoopGitOps("commit", ops), emptyEngineLayer))
    expect(gitCalls).toEqual(["commit"])
  })

  test("commit_and_push executes commit then push", async () => {
    const ops = makeGitOps()
    await Effect.runPromise(
      Effect.provide(executePostLoopGitOps("commit_and_push", ops), emptyEngineLayer),
    )
    expect(gitCalls).toEqual(["commit", "push"])
  })

  test("commit_and_push skips push when no commit is created", async () => {
    mockedCommitResult = undefined
    const ops = makeGitOps()
    await Effect.runPromise(
      Effect.provide(executePostLoopGitOps("commit_and_push", ops), emptyEngineLayer),
    )
    expect(gitCalls).toEqual(["commit"])
  })

  test("commit_and_push_and_wait_ci executes commit then push then wait_ci", async () => {
    const ops = makeGitOps()
    // In-loop CI step
    await Effect.runPromise(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))
    // Post-loop step should be a no-op for this mode
    await Effect.runPromise(
      Effect.provide(executePostLoopGitOps("commit_and_push_and_wait_ci", ops), emptyEngineLayer),
    )
    expect(gitCalls).toEqual(["commit", "push", "wait_ci"])
  })

  test("commit_and_push_and_wait_ci skips push and wait when no commit is created", async () => {
    mockedCommitResult = undefined
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(buildCiGitStep(ops), emptyEngineLayer))
    expect(gitCalls).toEqual(["commit"])
  })

  test("push is not attempted when commit fails", async () => {
    commitShouldFail = true
    const ops = makeGitOps()
    const result = await Effect.runPromiseExit(
      Effect.provide(executePostLoopGitOps("commit_and_push", ops), emptyEngineLayer),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      expect((result.cause.error as FatalError).message).toContain("commit failed")
    }
    expect(gitCalls).toEqual(["commit"])
  })

  test("gitModeOverride takes precedence over config mode", async () => {
    const gitMode = resolveGitMode({ ...baseConfig, git: { mode: "none" } }, "commit")
    expect(gitMode).toBe("commit")

    // Verify the resolved mode is used by executing the post-loop git ops
    const ops = makeGitOps()
    await Effect.runPromise(Effect.provide(executePostLoopGitOps(gitMode, ops), emptyEngineLayer))
    expect(gitCalls).toEqual(["commit"])
  })

  test("wait_ci is not attempted when push fails", async () => {
    pushShouldFail = true
    const ops = makeGitOps()
    const result = await Effect.runPromiseExit(
      Effect.provide(buildCiGitStep(ops), emptyEngineLayer),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      expect((result.cause.error as FatalError).message).toContain("push failed")
    }
    expect(gitCalls).toEqual(["commit", "push"])
  })

  test("run fails when wait_ci fails", async () => {
    waitCiShouldFail = true
    const ops = makeGitOps()
    const result = await Effect.runPromiseExit(
      Effect.provide(buildCiGitStep(ops), emptyEngineLayer),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      expect((result.cause.error as CheckFailure).stderr).toContain("CI failed")
    }
    expect(gitCalls).toEqual(["commit", "push", "wait_ci"])
  })
})
