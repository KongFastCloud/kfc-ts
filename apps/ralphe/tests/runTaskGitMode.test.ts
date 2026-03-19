import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { RalpheConfig } from "../src/config.js"
import { FatalError } from "../src/errors.js"

let gitCalls: string[] = []
let mockedCommitResult: { message: string; hash: string } | undefined = {
  message: "feat: test commit",
  hash: "abc1234",
}
let commitShouldFail = false
let pushShouldFail = false
let waitCiShouldFail = false

let runTask: typeof import("../src/runTask.js").runTask

const baseConfig: RalpheConfig = {
  engine: "claude",
  maxAttempts: 1,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

beforeEach(() => {
  gitCalls = []
  mockedCommitResult = { message: "feat: test commit", hash: "abc1234" }
  commitShouldFail = false
  pushShouldFail = false
  waitCiShouldFail = false
})

beforeAll(async () => {
  mock.module("../src/agent.js", () => ({
    agent: () => Effect.succeed({ response: "ok", resumeToken: "tok-1" }),
  }))

  mock.module("../src/cmd.js", () => ({
    cmd: () => Effect.succeed({ stdout: "ok" }),
  }))

  mock.module("../src/loop.js", () => ({
    loop: (fn: (feedback?: string) => Effect.Effect<unknown, never>) => fn(undefined),
  }))

  mock.module("../src/report.js", () => ({
    report: () => Effect.succeed({ success: true, report: "ok" }),
  }))

  mock.module("../src/engine/ClaudeEngine.js", () => ({
    ClaudeEngineLayer: Layer.empty,
  }))

  mock.module("../src/engine/CodexEngine.js", () => ({
    CodexEngineLayer: Layer.empty,
  }))

  mock.module("../src/git.js", () => ({
    gitCommit: () =>
      Effect.gen(function* () {
        gitCalls.push("commit")
        if (commitShouldFail) {
          return yield* Effect.fail(
            new FatalError({ command: "git commit", message: "commit failed" }),
          )
        }
        return mockedCommitResult
      }),
    gitPush: () =>
      Effect.gen(function* () {
        gitCalls.push("push")
        if (pushShouldFail) {
          return yield* Effect.fail(
            new FatalError({ command: "git push", message: "push failed" }),
          )
        }
        return { remote: "origin", ref: "main", output: "" }
      }),
    gitWaitForCi: () =>
      Effect.gen(function* () {
        gitCalls.push("wait_ci")
        if (waitCiShouldFail) {
          return yield* Effect.fail(
            new FatalError({ command: "gh run watch", message: "ci failed" }),
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
  }))

  // @ts-expect-error Bun test isolation import suffix is runtime-only.
  ;({ runTask } = await import("../src/runTask.js?runTaskGitMode") as typeof import("../src/runTask.js"))
})

afterAll(() => {
  mock.restore()
})

describe("runTask git mode behavior", () => {
  test("none mode executes no git operations", async () => {
    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "none" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual([])
  })

  test("commit mode executes commit only", async () => {
    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit"])
  })

  test("commit_and_push executes commit then push", async () => {
    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit", "push"])
  })

  test("commit_and_push skips push when no commit is created", async () => {
    mockedCommitResult = undefined

    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit"])
  })

  test("commit_and_push_and_wait_ci executes commit then push then wait_ci", async () => {
    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push_and_wait_ci" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit", "push", "wait_ci"])
  })

  test("commit_and_push_and_wait_ci skips push and wait when no commit is created", async () => {
    mockedCommitResult = undefined

    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push_and_wait_ci" } }),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit"])
  })

  test("push is not attempted when commit fails", async () => {
    commitShouldFail = true

    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push" } }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("commit failed")
    expect(gitCalls).toEqual(["commit"])
  })

  test("gitModeOverride takes precedence over config mode", async () => {
    const result = await Effect.runPromise(
      runTask(
        "task",
        { ...baseConfig, git: { mode: "none" } },
        { gitModeOverride: "commit" },
      ),
    )

    expect(result.success).toBe(true)
    expect(gitCalls).toEqual(["commit"])
  })

  test("wait_ci is not attempted when push fails", async () => {
    pushShouldFail = true

    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push_and_wait_ci" } }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("push failed")
    expect(gitCalls).toEqual(["commit", "push"])
  })

  test("run fails when wait_ci fails", async () => {
    waitCiShouldFail = true

    const result = await Effect.runPromise(
      runTask("task", { ...baseConfig, git: { mode: "commit_and_push_and_wait_ci" } }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("ci failed")
    expect(gitCalls).toEqual(["commit", "push", "wait_ci"])
  })
})
