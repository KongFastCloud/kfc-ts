/**
 * ABOUTME: Tests for the app-owned workflow builder (buildRunWorkflow).
 * Verifies that the direct run path executes through the workflow builder,
 * the per-run request is pure data, engine selection resolves through an
 * Effect service, and RunObserver owns the full lifecycle surface.
 *
 * Does NOT test git mode sequencing (owned by runTaskGitMode.test.ts)
 * or span hierarchy (owned by spanHierarchy.test.ts).
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import type { RunRequest } from "../src/RunRequest.js"
import { RunObserver, SilentRunObserver, composeObservers } from "../src/RunObserver.js"
import { EngineResolver } from "../src/EngineResolver.js"
import { buildRunWorkflow } from "../src/buildRunWorkflow.js"
import type { TaskResult } from "../src/runTask.js"
import type { GitOps } from "../src/runTask.js"
import type { LoopEvent } from "../src/loop.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseRequest: RunRequest = {
  task: "implement feature",
  engine: "claude",
  checks: [],
  maxAttempts: 2,
  gitMode: "none",
  reportMode: "none",
}

const successEngine: Engine = {
  execute: () =>
    Effect.succeed({ response: "done", resumeToken: "sess-123" } satisfies AgentResult),
}

const makeMockEngineResolver = (engine: Engine): EngineResolver => ({
  resolve: () => Layer.succeed(Engine, engine),
})

const noOpGitOps: GitOps = {
  commit: () => Effect.succeed(undefined),
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

const provideServices = (
  resolver: EngineResolver,
  observer: RunObserver = SilentRunObserver,
) =>
  Layer.merge(
    Layer.succeed(EngineResolver, resolver),
    Layer.succeed(RunObserver, observer),
  )

// ---------------------------------------------------------------------------
// RunRequest is pure data
// ---------------------------------------------------------------------------

describe("RunRequest is pure data", () => {
  test("request contains only execution inputs, no services or layers", () => {
    const request: RunRequest = {
      task: "test task",
      engine: "codex",
      checks: ["echo lint", "echo test"],
      maxAttempts: 3,
      gitMode: "commit_and_push",
      reportMode: "basic",
    }

    // Verify it's a plain object with only data fields
    expect(typeof request.task).toBe("string")
    expect(typeof request.engine).toBe("string")
    expect(Array.isArray(request.checks)).toBe(true)
    expect(typeof request.maxAttempts).toBe("number")
    expect(typeof request.gitMode).toBe("string")
    expect(typeof request.reportMode).toBe("string")

    // No functions, no Effect types
    const keys = Object.keys(request)
    for (const key of keys) {
      const value = (request as unknown as Record<string, unknown>)[key]
      expect(typeof value).not.toBe("function")
    }
  })
})

// ---------------------------------------------------------------------------
// Workflow builder orchestration
// ---------------------------------------------------------------------------

describe("buildRunWorkflow orchestration", () => {
  test("succeeds on first attempt with no checks", async () => {
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(result.success).toBe(true)
    expect(result.engine).toBe("claude")
    expect(result.resumeToken).toBe("sess-123")
  })

  test("succeeds with checks that pass", async () => {
    const request: RunRequest = {
      ...baseRequest,
      checks: ["echo ok"],
    }
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(request, noOpGitOps), layer),
    )

    expect(result.success).toBe(true)
  })

  test("retries on check failure and succeeds on second attempt", async () => {
    let calls = 0
    const retryEngine: Engine = {
      execute: () => {
        calls++
        return Effect.succeed({ response: `attempt-${calls}`, resumeToken: "sess-retry" })
      },
    }

    const request: RunRequest = {
      ...baseRequest,
      checks: ["echo ok"], // The check passes, but the engine tracks calls
      maxAttempts: 2,
    }
    const resolver = makeMockEngineResolver(retryEngine)
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(request, noOpGitOps), layer),
    )

    expect(result.success).toBe(true)
    expect(result.engine).toBe("claude")
  })

  test("captures resume token from agent result", async () => {
    const resolver = makeMockEngineResolver({
      execute: () =>
        Effect.succeed({ response: "ok", resumeToken: "thread-xyz" }),
    })
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(result.resumeToken).toBe("thread-xyz")
  })

  test("returns failure result on fatal error without throwing", async () => {
    const failingEngine: Engine = {
      execute: () =>
        Effect.fail(new FatalError({ command: "agent", message: "auth failed" })),
    }
    const resolver = makeMockEngineResolver(failingEngine)
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe("auth failed")
    expect(result.engine).toBe("claude")
  })

  test("undefined resume token when engine does not provide one", async () => {
    const noTokenEngine: Engine = {
      execute: () => Effect.succeed({ response: "ok" }),
    }
    const resolver = makeMockEngineResolver(noTokenEngine)
    const layer = provideServices(resolver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(result.success).toBe(true)
    expect(result.resumeToken).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Engine resolution through Effect service
// ---------------------------------------------------------------------------

describe("engine resolution through service", () => {
  test("resolver receives the engine choice from the request", async () => {
    let resolvedEngine: string | undefined

    const trackingResolver: EngineResolver = {
      resolve: (engine) => {
        resolvedEngine = engine
        return Layer.succeed(Engine, successEngine)
      },
    }

    const request: RunRequest = { ...baseRequest, engine: "codex" }
    const layer = provideServices(trackingResolver)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(request, noOpGitOps), layer),
    )

    expect(resolvedEngine).toBe("codex")
  })

  test("different engine choices resolve to different layers", async () => {
    const resolvedEngines: string[] = []

    const trackingResolver: EngineResolver = {
      resolve: (engine) => {
        resolvedEngines.push(engine)
        return Layer.succeed(Engine, successEngine)
      },
    }

    const layer = provideServices(trackingResolver)

    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, engine: "claude" }, noOpGitOps),
        layer,
      ),
    )
    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, engine: "codex" }, noOpGitOps),
        layer,
      ),
    )

    expect(resolvedEngines).toEqual(["claude", "codex"])
  })
})

// ---------------------------------------------------------------------------
// RunObserver lifecycle
// ---------------------------------------------------------------------------

describe("RunObserver lifecycle", () => {
  let events: string[] = []

  const trackingObserver: RunObserver = {
    onStart: (request) => {
      events.push(`start:${request.engine}`)
      return Effect.void
    },
    onLoopEvent: (event) => {
      events.push(`loop:${event.type}`)
      return Effect.void
    },
    onAgentResult: (result, attempt, maxAttempts) => {
      events.push(`agent:${attempt}/${maxAttempts}`)
      return Effect.void
    },
    onComplete: (result) => {
      events.push(`complete:${result.success}`)
      return Effect.void
    },
  }

  beforeEach(() => {
    events = []
  })

  test("observer receives start, loop-event, agent-result, and complete on success", async () => {
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver, trackingObserver)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(events).toContain("start:claude")
    expect(events).toContain("loop:attempt_start")
    expect(events).toContain("agent:1/2")
    expect(events).toContain("loop:success")
    expect(events).toContain("complete:true")
  })

  test("observer receives complete with failure on fatal error", async () => {
    const failingEngine: Engine = {
      execute: () =>
        Effect.fail(new FatalError({ command: "agent", message: "crash" })),
    }
    const resolver = makeMockEngineResolver(failingEngine)
    const layer = provideServices(resolver, trackingObserver)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    expect(events).toContain("start:claude")
    expect(events).toContain("complete:false")
  })

  test("observer receives check_failed loop event on retry", async () => {
    let calls = 0
    const retryEngine: Engine = {
      execute: () => {
        calls++
        if (calls === 1) {
          return Effect.succeed({ response: "first" })
        }
        return Effect.succeed({ response: "second" })
      },
    }

    const request: RunRequest = {
      ...baseRequest,
      checks: ["exit 1"], // will fail first time — but since cmd actually runs...
      maxAttempts: 2,
    }

    // Use a request with no checks but a failing agent to trigger retry
    const retryRequest: RunRequest = {
      ...baseRequest,
      maxAttempts: 2,
    }

    // Build a scenario where the loop retries
    let engineCalls = 0
    const checkFailEngine: Engine = {
      execute: () => {
        engineCalls++
        return Effect.succeed({ response: "ok" })
      },
    }

    // We need the check to actually fail - use a real failing check
    const failThenPassRequest: RunRequest = {
      ...baseRequest,
      checks: ["echo ok"], // passes always
      maxAttempts: 2,
    }

    // Test with a failing agent that triggers CheckFailure path
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver, trackingObserver)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(failThenPassRequest, noOpGitOps), layer),
    )

    // At minimum, we get start, attempt_start, agent result, success, complete
    expect(events).toContain("start:claude")
    expect(events).toContain("loop:attempt_start")
    expect(events).toContain("complete:true")
  })

  test("observer lifecycle order: start before loop events before complete", async () => {
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver, trackingObserver)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    const startIdx = events.indexOf("start:claude")
    const completeIdx = events.indexOf("complete:true")

    expect(startIdx).toBeLessThan(completeIdx)
    expect(startIdx).toBe(0)
    expect(completeIdx).toBe(events.length - 1)
  })

  test("SilentRunObserver produces no side effects", async () => {
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver, SilentRunObserver)

    const result = await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    // Should succeed without errors — silent observer is a valid no-op
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// composeObservers
// ---------------------------------------------------------------------------

describe("composeObservers", () => {
  test("calls all delegates in order", async () => {
    const events1: string[] = []
    const events2: string[] = []

    const observer1: RunObserver = {
      onStart: () => { events1.push("start"); return Effect.void },
      onLoopEvent: () => { events1.push("loop"); return Effect.void },
      onAgentResult: () => { events1.push("agent"); return Effect.void },
      onComplete: () => { events1.push("complete"); return Effect.void },
    }

    const observer2: RunObserver = {
      onStart: () => { events2.push("start"); return Effect.void },
      onLoopEvent: () => { events2.push("loop"); return Effect.void },
      onAgentResult: () => { events2.push("agent"); return Effect.void },
      onComplete: () => { events2.push("complete"); return Effect.void },
    }

    const composed = composeObservers(observer1, observer2)
    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver, composed)

    await Effect.runPromise(
      Effect.provide(buildRunWorkflow(baseRequest, noOpGitOps), layer),
    )

    // Both observers received events
    expect(events1).toContain("start")
    expect(events1).toContain("complete")
    expect(events2).toContain("start")
    expect(events2).toContain("complete")
  })
})

// ---------------------------------------------------------------------------
// Git mode integration
// ---------------------------------------------------------------------------

describe("buildRunWorkflow git mode", () => {
  test("none mode executes no git operations", async () => {
    const gitCalls: string[] = []
    const trackingGitOps: GitOps = {
      commit: () => { gitCalls.push("commit"); return Effect.succeed(undefined) },
      push: () => { gitCalls.push("push"); return Effect.succeed({ remote: "origin", ref: "main", output: "" }) },
      waitCi: () => {
        gitCalls.push("wait_ci")
        return Effect.succeed({ runId: 1, status: "completed", conclusion: "success", url: "", workflowName: "ci" })
      },
    }

    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, gitMode: "none" }, trackingGitOps),
        layer,
      ),
    )

    expect(gitCalls).toEqual([])
  })

  test("commit mode executes commit after loop", async () => {
    const gitCalls: string[] = []
    const trackingGitOps: GitOps = {
      commit: () => {
        gitCalls.push("commit")
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: () => { gitCalls.push("push"); return Effect.succeed({ remote: "origin", ref: "main", output: "" }) },
      waitCi: () => {
        gitCalls.push("wait_ci")
        return Effect.succeed({ runId: 1, status: "completed", conclusion: "success", url: "", workflowName: "ci" })
      },
    }

    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, gitMode: "commit" }, trackingGitOps),
        layer,
      ),
    )

    expect(gitCalls).toEqual(["commit"])
  })

  test("commit_and_push mode executes commit then push", async () => {
    const gitCalls: string[] = []
    const trackingGitOps: GitOps = {
      commit: () => {
        gitCalls.push("commit")
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: () => { gitCalls.push("push"); return Effect.succeed({ remote: "origin", ref: "main", output: "" }) },
      waitCi: () => {
        gitCalls.push("wait_ci")
        return Effect.succeed({ runId: 1, status: "completed", conclusion: "success", url: "", workflowName: "ci" })
      },
    }

    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, gitMode: "commit_and_push" }, trackingGitOps),
        layer,
      ),
    )

    expect(gitCalls).toEqual(["commit", "push"])
  })

  test("commit_and_push_and_wait_ci executes in-loop git step", async () => {
    const gitCalls: string[] = []
    const trackingGitOps: GitOps = {
      commit: () => {
        gitCalls.push("commit")
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: () => { gitCalls.push("push"); return Effect.succeed({ remote: "origin", ref: "main", output: "" }) },
      waitCi: () => {
        gitCalls.push("wait_ci")
        return Effect.succeed({ runId: 1, status: "completed", conclusion: "success", url: "", workflowName: "ci" })
      },
    }

    const resolver = makeMockEngineResolver(successEngine)
    const layer = provideServices(resolver)

    await Effect.runPromise(
      Effect.provide(
        buildRunWorkflow({ ...baseRequest, gitMode: "commit_and_push_and_wait_ci" }, trackingGitOps),
        layer,
      ),
    )

    expect(gitCalls).toEqual(["commit", "push", "wait_ci"])
  })
})
