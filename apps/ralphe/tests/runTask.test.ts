/**
 * ABOUTME: Tests for run-task orchestration and comment formatting.
 * Owns the agent → checks → loop composition pattern (success, retry with
 * feedback, fatal propagation, resume token capture) and the format functions
 * used in beads issue comments (formatSessionComment, formatCheckFailedComment,
 * formatSuccessComment).
 *
 * Does NOT test git mode selection — that is owned by runTaskGitMode.test.ts.
 */

import { describe, test, expect } from "bun:test"
import { Effect, Layer, pipe } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { FatalError } from "../src/errors.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { loop } from "../src/loop.js"
import { formatSessionComment, formatCheckFailedComment, formatSuccessComment } from "../src/runTask.js"
import type { RalpheConfig } from "../src/config.js"

const baseConfig: RalpheConfig = {
  engine: "claude",
  maxAttempts: 2,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

/**
 * These tests verify the shared orchestration logic that runTask composes:
 * agent → checks → loop. We test the same composition pattern with mock engines
 * since runTask internally creates real engine layers.
 */
describe("shared executor orchestration", () => {
  test("agent + checks succeed on first attempt", async () => {
    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "done", resumeToken: "sess-123" } satisfies AgentResult),
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("implement feature", { feedback })
        return pipe(pipeline, Effect.andThen(cmd("echo ok")))
      },
      { maxAttempts: baseConfig.maxAttempts },
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
  })

  test("retry passes feedback on check failure then succeeds", async () => {
    let calls = 0
    const mockLayer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.succeed({ response: `attempt-${calls}`, resumeToken: "sess-abc" })
      },
    })

    const workflow = loop(
      (feedback) => {
        const pipeline = agent("fix bug", { feedback })
        return pipe(
          pipeline,
          Effect.andThen(
            calls === 0
              ? cmd("exit 1") // fail first attempt
              : cmd("echo ok"),
          ),
        )
      },
      { maxAttempts: 2 },
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(calls).toBe(2)
  })

  test("resume token is available from agent result", async () => {
    let capturedToken: string | undefined

    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "ok", resumeToken: "thread-xyz" }),
    })

    const workflow = agent("task", {}).pipe(
      Effect.tap((result) => {
        capturedToken = result.resumeToken
        return Effect.void
      }),
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(capturedToken).toBe("thread-xyz")
  })

  test("fatal error propagates without retry", async () => {
    let calls = 0
    const mockLayer = Layer.succeed(Engine, {
      execute: () => {
        calls++
        return Effect.fail(new FatalError({ command: "agent", message: "auth failed" }))
      },
    })

    const workflow = loop(
      (feedback) => agent("task", { feedback }),
      { maxAttempts: 3 },
    )

    const result = await Effect.runPromiseExit(Effect.provide(workflow, mockLayer))
    expect(calls).toBe(1)
    expect(result._tag).toBe("Failure")
  })

  test("agent result includes undefined resumeToken when not provided", async () => {
    let capturedToken: string | undefined = "not-set"

    const mockLayer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({ response: "ok" }),
    })

    const workflow = agent("task", {}).pipe(
      Effect.tap((result) => {
        capturedToken = result.resumeToken
        return Effect.void
      }),
    )

    await Effect.runPromise(Effect.provide(workflow, mockLayer))
    expect(capturedToken).toBeUndefined()
  })
})

describe("formatSessionComment", () => {
  test("formats Claude resume command", () => {
    const comment = formatSessionComment("claude", 1, 3, "sess-abc123")
    expect(comment).toBe("[attempt 1/3] claude --resume sess-abc123")
  })

  test("formats Codex resume command", () => {
    const comment = formatSessionComment("codex", 2, 3, "thread-xyz789")
    expect(comment).toBe("[attempt 2/3] codex resume thread-xyz789")
  })

  test("handles no resume token", () => {
    const comment = formatSessionComment("claude", 1, 2, undefined)
    expect(comment).toBe("[attempt 1/2] agent completed (no session id)")
  })

  test("handles no resume token for codex", () => {
    const comment = formatSessionComment("codex", 3, 5, undefined)
    expect(comment).toBe("[attempt 3/5] agent completed (no session id)")
  })
})

describe("formatCheckFailedComment", () => {
  test("formats check failure with feedback", () => {
    const comment = formatCheckFailedComment(1, 3, 'Command "test" failed (exit 1):\ntype error')
    expect(comment).toBe('[attempt 1/3] check failed — Command "test" failed (exit 1):\ntype error')
  })

  test("formats CI failure with annotations", () => {
    const feedback = 'Command "CI run 12345" failed (exit 1):\nFAIL src/app.test.ts'
    const comment = formatCheckFailedComment(2, 3, feedback)
    expect(comment).toBe(`[attempt 2/3] check failed — ${feedback}`)
  })
})

describe("formatSuccessComment", () => {
  test("formats success comment", () => {
    const comment = formatSuccessComment(2, 3)
    expect(comment).toBe("[attempt 2/3] all checks passed")
  })

  test("formats success on first attempt", () => {
    const comment = formatSuccessComment(1, 1)
    expect(comment).toBe("[attempt 1/1] all checks passed")
  })
})
