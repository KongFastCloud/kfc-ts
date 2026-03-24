/**
 * ABOUTME: Tests for the blueprints execution runner.
 * Verifies the full pipeline: agent → checks → loop composition,
 * retry with feedback, fatal error propagation, resume token capture,
 * lifecycle event callbacks, onAgentResult callbacks, and explicit
 * workspace propagation to report and git surfaces.
 */

import { describe, test, expect, afterAll } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, pipe } from "effect"
import { Engine, type AgentResult } from "../src/engine.js"
import { FatalError } from "../src/errors.js"
import { run, type RunConfig, type RunResult, type GitOps } from "../src/runner.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { loop } from "../src/loop.js"
import type { LoopEvent } from "../src/loop.js"

const testWorkspace = fs.realpathSync(os.tmpdir())

const baseConfig: RunConfig = {
  maxAttempts: 2,
  checks: [],
  gitMode: "none",
  report: "none",
}

const mockEngineLayer = (executeFn?: () => Effect.Effect<AgentResult, any>) =>
  Layer.succeed(Engine, {
    execute: executeFn ?? (() =>
      Effect.succeed({ response: "done", resumeToken: "sess-123" })),
  })

describe("runner.run", () => {
  test("succeeds on first attempt with no checks", async () => {
    const result = await Effect.runPromise(
      run({
        task: "implement feature",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.resumeToken).toBe("sess-123")
    expect(result.attempts).toBe(1)
    expect(result.error).toBeUndefined()
  })

  test("succeeds with passing checks", async () => {
    const result = await Effect.runPromise(
      run({
        task: "implement feature",
        workspace: testWorkspace,
        config: { ...baseConfig, checks: ["echo ok"] },
        engineLayer: mockEngineLayer(),
      }),
    )
    expect(result.success).toBe(true)
  })

  test("captures fatal error without throwing", async () => {
    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(() =>
          Effect.fail(new FatalError({ command: "agent", message: "auth failed" })),
        ),
      }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe("auth failed")
  })

  test("captures resume token from agent result", async () => {
    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(() =>
          Effect.succeed({ response: "ok", resumeToken: "thread-xyz" }),
        ),
      }),
    )
    expect(result.resumeToken).toBe("thread-xyz")
  })

  test("fires onEvent callbacks", async () => {
    const events: LoopEvent[] = []
    await Effect.runPromise(
      run({
        task: "task",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(),
        onEvent: (event) => {
          events.push(event)
          return Effect.void
        },
      }),
    )
    expect(events).toEqual([
      { type: "attempt_start", attempt: 1, maxAttempts: 2 },
      { type: "success", attempt: 1, maxAttempts: 2 },
    ])
  })

  test("fires onAgentResult callback", async () => {
    const results: Array<{ token: string | undefined; attempt: number }> = []
    await Effect.runPromise(
      run({
        task: "task",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(),
        onAgentResult: (result, attempt) => {
          results.push({ token: result.resumeToken, attempt })
          return Effect.void
        },
      }),
    )
    expect(results).toEqual([{ token: "sess-123", attempt: 1 }])
  })

  test("handles undefined resume token gracefully", async () => {
    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace: testWorkspace,
        config: baseConfig,
        engineLayer: mockEngineLayer(() =>
          Effect.succeed({ response: "ok" }),
        ),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.resumeToken).toBeUndefined()
  })
})

/**
 * Lower-level composition tests that verify the same patterns
 * the runner uses internally, with mock engines.
 */
describe("shared executor orchestration", () => {
  const ws = testWorkspace

  test("agent + checks succeed on first attempt", async () => {
    const layer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "done", resumeToken: "sess-123" } satisfies AgentResult),
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("implement feature", ws, { feedback })
        return pipe(pipeline, Effect.andThen(cmd("echo ok", ws)))
      },
      { maxAttempts: baseConfig.maxAttempts },
    )

    await Effect.runPromise(Effect.provide(workflow, layer))
  })

  test("retry passes feedback on check failure then succeeds", async () => {
    let calls = 0
    const layer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.succeed({ response: `attempt-${calls}`, resumeToken: "sess-abc" })
      },
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("fix bug", ws, { feedback })
        return pipe(
          pipeline,
          Effect.andThen(
            calls === 0
              ? cmd("exit 1", ws)
              : cmd("echo ok", ws),
          ),
        )
      },
      { maxAttempts: 2 },
    )

    await Effect.runPromise(Effect.provide(workflow, layer))
    expect(calls).toBe(2)
  })

  test("resume token is available from agent result", async () => {
    let capturedToken: string | undefined

    const layer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "ok", resumeToken: "thread-xyz" }),
    })

    const workflow = agent("task", ws, {}).pipe(
      Effect.tap((result) => {
        capturedToken = result.resumeToken
        return Effect.void
      }),
    )

    await Effect.runPromise(Effect.provide(workflow, layer))
    expect(capturedToken).toBe("thread-xyz")
  })

  test("fatal error propagates without retry", async () => {
    let calls = 0
    const layer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.fail(new FatalError({ command: "agent", message: "auth failed" }))
      },
    })

    const workflow = loop(
      (feedback) => agent("task", ws, { feedback }),
      { maxAttempts: 3 },
    )

    const result = await Effect.runPromiseExit(Effect.provide(workflow, layer))
    expect(calls).toBe(1)
    expect(result._tag).toBe("Failure")
  })
})

/**
 * Workspace contract tests.
 * Verify that the runner threads the explicit workspace to report and git
 * surfaces — the same workspace used for agent and check execution.
 */
describe("workspace contract", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "bp-ws-"))
  const workspace = fs.realpathSync(ws)

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  const successReport = JSON.stringify({ success: true, report: "ok" })
  const reportResponse = `done\n\n\`\`\`json\n${successReport}\n\`\`\``

  test("report step receives the configured workspace", async () => {
    let engineWorkDir: string | undefined

    const result = await Effect.runPromise(
      run({
        task: "implement feature",
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "none",
          report: "basic",
        },
        engineLayer: Layer.succeed(Engine, {
          execute: (_prompt: string, workDir: string) => {
            engineWorkDir = workDir
            return Effect.succeed({ response: reportResponse })
          },
        }),
      }),
    )

    expect(result.success).toBe(true)
    // Engine was called with the explicit workspace for both agent and report
    expect(engineWorkDir).toBe(workspace)
  })

  test("report step creates reports directory inside workspace", async () => {
    await Effect.runPromise(
      run({
        task: "implement feature",
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "none",
          report: "basic",
        },
        engineLayer: Layer.succeed(Engine, {
          execute: () => Effect.succeed({ response: reportResponse }),
        }),
      }),
    )

    const reportsDir = path.join(workspace, ".blueprints/reports")
    expect(fs.existsSync(reportsDir)).toBe(true)
  })

  test("git ops receive the configured workspace (commit mode)", async () => {
    let gitWorkspace: string | undefined

    const fakeGitOps: GitOps = {
      commit: (ws) => {
        gitWorkspace = ws
        return Effect.succeed(undefined)
      },
      push: () => Effect.succeed({ remote: "origin", ref: "main", output: "" }),
      waitCi: () =>
        Effect.succeed({
          runId: 1,
          status: "completed",
          conclusion: "success",
          url: null,
          workflowName: null,
        }),
    }

    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "commit",
          report: "none",
        },
        engineLayer: Layer.succeed(Engine, {
          execute: () => Effect.succeed({ response: "done" }),
        }),
        gitOps: fakeGitOps,
      }),
    )

    expect(result.success).toBe(true)
    expect(gitWorkspace).toBe(workspace)
  })

  test("git ops receive the configured workspace (commit_and_push mode)", async () => {
    const receivedWorkspaces: string[] = []

    const fakeGitOps: GitOps = {
      commit: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ remote: "origin", ref: "main", output: "" })
      },
      waitCi: () =>
        Effect.succeed({
          runId: 1,
          status: "completed",
          conclusion: "success",
          url: null,
          workflowName: null,
        }),
    }

    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "commit_and_push",
          report: "none",
        },
        engineLayer: Layer.succeed(Engine, {
          execute: () => Effect.succeed({ response: "done" }),
        }),
        gitOps: fakeGitOps,
      }),
    )

    expect(result.success).toBe(true)
    expect(receivedWorkspaces).toEqual([workspace, workspace])
  })

  test("CI git step receives workspace (commit_and_push_and_wait_ci mode)", async () => {
    const receivedWorkspaces: string[] = []

    const fakeGitOps: GitOps = {
      commit: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ message: "feat: ci", hash: "def5678" })
      },
      push: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ remote: "origin", ref: "main", output: "" })
      },
      waitCi: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({
          runId: 42,
          status: "completed",
          conclusion: "success",
          url: "https://github.com/test/actions/runs/42",
          workflowName: "CI",
        })
      },
    }

    const result = await Effect.runPromise(
      run({
        task: "task",
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "commit_and_push_and_wait_ci",
          report: "none",
        },
        engineLayer: Layer.succeed(Engine, {
          execute: () => Effect.succeed({ response: "done" }),
        }),
        gitOps: fakeGitOps,
      }),
    )

    expect(result.success).toBe(true)
    // All three git ops should receive the workspace
    expect(receivedWorkspaces).toEqual([workspace, workspace, workspace])
  })
})
