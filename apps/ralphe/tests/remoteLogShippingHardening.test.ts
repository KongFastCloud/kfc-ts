/**
 * ABOUTME: Hardening and regression tests for remote log shipping integration.
 *
 * Covers the gaps between unit-level remoteLogger tests and orchestration tests:
 *
 * 1. Watch workflow milestone logs land in the remote buffer at correct levels.
 * 2. TUI mode suppresses stderr while remote shipping remains active at the
 *    orchestration layer (controller + worker).
 * 3. Missing config or remote sink failures do not break watch or run workflows.
 * 4. The remote log level policy and milestone behavior remain stable across
 *    the full pipeline without live Axiom access.
 *
 * Uses deterministic remote-sink fakes via the existing _resetForTesting /
 * _getBufferForTesting test seams. No global mocking, no live network access.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect, Logger, Layer } from "effect"
import {
  initRemoteLogger,
  shutdownRemoteLogger,
  getRemoteLogger,
  _resetForTesting,
  _getBufferForTesting,
} from "../src/remoteLogger.js"
import { AppLoggerLayer, TuiLoggerLayer } from "../src/logger.js"
import {
  processClaimedTask,
  pollClaimAndProcess,
  type WatchWorkflowDeps,
} from "../src/watchWorkflow.js"
import type { RalpheConfig } from "../src/config.js"
import type { BeadsIssue, BeadsMetadata } from "../src/beads.js"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import { EngineResolver } from "../src/EngineResolver.js"
import { FatalError } from "../src/errors.js"
import {
  createTuiWatchController,
  type TuiWatchControllerDeps,
} from "../src/tuiWatchController.js"
import {
  tuiWorkerEffect,
  type TuiWorkerDeps,
} from "../src/tuiWorker.js"

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseConfig: RalpheConfig = {
  engine: "claude",
  checks: [],
  report: "none",
  maxAttempts: 1,
  git: { mode: "none" },
}

function makeIssue(id: string, title = `Task ${id}`): BeadsIssue {
  return { id, title, description: `Description for ${id}` }
}

let workflowCalls: Array<{ op: string; id?: string }> = []
let engineResult: Effect.Effect<AgentResult, FatalError> =
  Effect.succeed({ response: "done", resumeToken: "tok-test" })

const makeMockEngineResolverLayer = (): Layer.Layer<EngineResolver> => {
  const mockResolver: EngineResolver = {
    resolve: () => Layer.succeed(Engine, { execute: () => engineResult }),
  }
  return Layer.succeed(EngineResolver, mockResolver)
}

function makeWorkflowDeps(overrides?: Partial<WatchWorkflowDeps>): WatchWorkflowDeps {
  return {
    loadConfig: () => baseConfig,
    queryQueued: () => Effect.succeed([]),
    claimTask: () => Effect.succeed(true),
    closeTaskSuccess: (id) => {
      workflowCalls.push({ op: "closeTaskSuccess", id })
      return Effect.succeed(undefined)
    },
    writeMetadata: (id, _meta) => {
      workflowCalls.push({ op: "writeMetadata", id })
      return Effect.succeed(undefined)
    },
    readMetadata: (id) => {
      workflowCalls.push({ op: "readMetadata", id })
      return Effect.succeed(undefined)
    },
    buildPromptFromIssue: (issue) => issue.title,
    markTaskExhaustedFailure: (id, _reason, _meta) => {
      workflowCalls.push({ op: "markTaskExhaustedFailure", id })
      return Effect.succeed(undefined)
    },
    addComment: (_id, _text) => Effect.succeed(undefined),
    engineResolverLayer: makeMockEngineResolverLayer(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Environment setup / teardown
// ---------------------------------------------------------------------------

let originalCwd: string

beforeEach(() => {
  _resetForTesting()
  delete process.env.AXIOM_TOKEN
  delete process.env.AXIOM_LOG_DATASET
  delete process.env.AXIOM_DOMAIN
  workflowCalls = []
  engineResult = Effect.succeed({ response: "done" })

  originalCwd = process.cwd()
  const fs = require("node:fs")
  const path = require("node:path")
  const os = require("node:os")
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-hardening-"))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await shutdownRemoteLogger()
  _resetForTesting()
  delete process.env.AXIOM_TOKEN
  delete process.env.AXIOM_LOG_DATASET
  delete process.env.AXIOM_DOMAIN
})

// ===========================================================================
// 1. Milestone logs from watch workflow reach the remote buffer
// ===========================================================================

describe("Watch workflow milestone logs reach remote buffer", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("processClaimedTask success emits info-level milestone to remote buffer", async () => {
    const issue = makeIssue("MS-1", "Feature work")
    engineResult = Effect.succeed({ response: "done" })

    // Run with a layer that includes the remote logger
    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(layer),
      ),
    )

    const buf = _getBufferForTesting()
    // The success path emits "Task completed successfully."
    const successEntry = buf.find((e) => String(e.message).includes("Task completed successfully"))
    expect(successEntry).toBeDefined()
    expect(successEntry!.level).toBe("INFO")
  })

  test("processClaimedTask failure emits warning-level milestone to remote buffer", async () => {
    const issue = makeIssue("MS-2", "Failing task")
    engineResult = Effect.fail(new FatalError({ command: "agent", message: "lint failed" }))

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(layer),
      ),
    )

    const buf = _getBufferForTesting()
    const exhaustedEntry = buf.find((e) =>
      String(e.message).includes("Task exhausted all retries"),
    )
    expect(exhaustedEntry).toBeDefined()
    expect(exhaustedEntry!.level).toBe("WARN")
  })

  test("processClaimedTask milestone carries normalized annotation fields", async () => {
    const issue = makeIssue("MS-3", "Annotated task")
    engineResult = Effect.succeed({ response: "done" })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(layer),
      ),
    )

    const buf = _getBufferForTesting()
    const entry = buf.find((e) => String(e.message).includes("Task completed"))
    expect(entry).toBeDefined()
    // processClaimedTask annotates with taskId → normalized to issue.id
    expect(entry!["issue.id"]).toBe("MS-3")
  })

  test("pollClaimAndProcess emits discovery and claim milestones to remote buffer", async () => {
    const issue = makeIssue("MS-4", "Discoverable task")
    const deps = makeWorkflowDeps({
      queryQueued: () => Effect.succeed([issue]),
      claimTask: () => Effect.succeed(true),
    })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(Effect.provide(layer)),
    )

    const buf = _getBufferForTesting()
    const messages = buf.map((e) => String(e.message))

    // Should contain "Found ready task" and "Claimed task" milestones
    expect(messages.some((m) => m.includes("Found ready task"))).toBe(true)
    expect(messages.some((m) => m.includes("Claimed task"))).toBe(true)
  })

  test("pollClaimAndProcess contention log is info-level and remote-eligible", async () => {
    const issue = makeIssue("MS-5", "Contended task")
    const deps = makeWorkflowDeps({
      queryQueued: () => Effect.succeed([issue]),
      claimTask: () => Effect.succeed(false), // Another worker claimed it
    })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(Effect.provide(layer)),
    )

    const buf = _getBufferForTesting()
    const contentionEntry = buf.find((e) =>
      String(e.message).includes("already claimed"),
    )
    expect(contentionEntry).toBeDefined()
    expect(contentionEntry!.level).toBe("INFO")
  })
})

// ===========================================================================
// 2. Debug-level logs from workflow do NOT reach remote buffer
// ===========================================================================

describe("Debug logs stay local-only in workflow context", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("debug-level logs emitted during workflow do not ship remotely", async () => {
    // A workflow dep that emits debug logs (simulating noisy polling internals)
    const deps = makeWorkflowDeps({
      queryQueued: () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("polling-heartbeat-noise")
          return []
        }),
    })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(Effect.provide(layer)),
    )

    const buf = _getBufferForTesting()
    const debugEntry = buf.find((e) =>
      String(e.message).includes("polling-heartbeat-noise"),
    )
    expect(debugEntry).toBeUndefined()
  })

  test("info logs ship while debug logs from the same workflow do not", async () => {
    const issue = makeIssue("MIX-1", "Mixed levels")
    const deps = makeWorkflowDeps({
      queryQueued: () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("internal-detail")
          return [issue]
        }),
      claimTask: () => Effect.succeed(true),
    })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(Effect.provide(layer)),
    )

    const buf = _getBufferForTesting()
    const messages = buf.map((e) => String(e.message))

    // Info milestones present
    expect(messages.some((m) => m.includes("Found ready task"))).toBe(true)
    // Debug noise absent
    expect(messages.some((m) => m.includes("internal-detail"))).toBe(false)
  })
})

// ===========================================================================
// 3. Missing config / fail-open at orchestration layer
// ===========================================================================

describe("Watch workflow completes normally without remote config", () => {
  test("processClaimedTask succeeds with no AXIOM env vars (remote is no-op)", async () => {
    // No AXIOM env vars set — remote logger is a silent no-op
    const issue = makeIssue("FO-1", "No remote config")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result.success).toBe(true)
    expect(result.taskId).toBe("FO-1")
    expect(_getBufferForTesting()).toHaveLength(0)
  })

  test("processClaimedTask failure path works with no remote config", async () => {
    engineResult = Effect.fail(new FatalError({ command: "agent", message: "build failed" }))
    const issue = makeIssue("FO-2", "Failing without remote")

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe("build failed")
    expect(_getBufferForTesting()).toHaveLength(0)
  })

  test("pollClaimAndProcess NoneReady path works with no remote config", async () => {
    const deps = makeWorkflowDeps({ queryQueued: () => Effect.succeed([]) })

    const result = await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result._tag).toBe("NoneReady")
  })

  test("pollClaimAndProcess full success path works with no remote config", async () => {
    const issue = makeIssue("FO-3", "Full cycle no remote")
    engineResult = Effect.succeed({ response: "done" })
    const deps = makeWorkflowDeps({
      queryQueued: () => Effect.succeed([issue]),
      claimTask: () => Effect.succeed(true),
    })

    const result = await Effect.runPromise(
      pollClaimAndProcess("/tmp", "w-1", deps).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result._tag).toBe("Processed")
    if (result._tag === "Processed") {
      expect(result.result.success).toBe(true)
    }
  })
})

describe("Watch workflow completes normally when remote is partially configured", () => {
  test("processClaimedTask succeeds with only AXIOM_TOKEN set (incomplete config)", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    // AXIOM_LOG_DATASET and AXIOM_DOMAIN intentionally missing
    initRemoteLogger()

    const issue = makeIssue("PC-1", "Partial config")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result.success).toBe(true)
    expect(_getBufferForTesting()).toHaveLength(0) // No remote buffering
  })
})

// ===========================================================================
// 4. TUI mode: stderr suppressed + remote shipping active (orchestration level)
// ===========================================================================

describe("TUI orchestration with active remote shipping", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("processClaimedTask under TuiLoggerLayer: stderr suppressed, remote buffered, file written", async () => {
    const issue = makeIssue("TUI-1", "TUI remote task")
    engineResult = Effect.succeed({ response: "done" })

    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      await Effect.runPromise(
        processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
          Effect.provide(TuiLoggerLayer),
        ),
      )

      // stderr must be clean (TUI suppression)
      expect(stderrOutput).not.toContain("Task completed")
      expect(stderrOutput).not.toContain("Found ready task")

      // Remote buffer should have the milestone
      const buf = _getBufferForTesting()
      expect(buf.some((e) => String(e.message).includes("Task completed successfully"))).toBe(true)

      // File should exist
      const fs = require("node:fs")
      const path = require("node:path")
      const d = new Date()
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, "0")
      const dd = String(d.getDate()).padStart(2, "0")
      const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)
      expect(fs.existsSync(logFile)).toBe(true)

      const content = fs.readFileSync(logFile, "utf-8").trim()
      const lines = content.split("\n").map((l: string) => JSON.parse(l))
      expect(lines.some((e: any) => e.message.includes("Task completed successfully"))).toBe(true)
    } finally {
      console.error = originalConsoleError
    }
  })

  test("pollClaimAndProcess failure under TuiLoggerLayer: stderr clean, warning in remote buffer", async () => {
    const issue = makeIssue("TUI-2", "TUI failing task")
    engineResult = Effect.fail(new FatalError({ command: "agent", message: "type error" }))
    const deps = makeWorkflowDeps({
      queryQueued: () => Effect.succeed([issue]),
      claimTask: () => Effect.succeed(true),
    })

    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      await Effect.runPromise(
        pollClaimAndProcess("/tmp", "w-1", deps).pipe(
          Effect.provide(TuiLoggerLayer),
        ),
      )

      // stderr clean
      expect(stderrOutput).not.toContain("exhausted")
      expect(stderrOutput).not.toContain("Task")

      // Warning-level milestone in remote buffer
      const buf = _getBufferForTesting()
      const exhaustedEntry = buf.find((e) =>
        String(e.message).includes("exhausted"),
      )
      expect(exhaustedEntry).toBeDefined()
      expect(exhaustedEntry!.level).toBe("WARN")
    } finally {
      console.error = originalConsoleError
    }
  })

  test("TUI controller worker with remote logger: stderr clean, remote buffer populated", async () => {
    let pollCount = 0

    const TestLayer: Layer.Layer<never> = Layer.merge(
      Logger.replace(
        Logger.defaultLogger,
        Logger.zip(
          Logger.make(() => {}), // no-op file logger stand-in
          getRemoteLogger(),
        ).pipe(Logger.map(() => void 0)),
      ),
      Layer.succeed({} as never, {} as never), // placeholder
    )

    // Use the real TuiLoggerLayer which includes the remote logger
    const workerDeps: TuiWorkerDeps = {
      loadConfig: () => baseConfig,
      queryQueued: () =>
        Effect.gen(function* () {
          pollCount++
          yield* Effect.logInfo("tui-worker-remote-check")
          return []
        }),
      claimTask: () => Effect.succeed(false),
      recoverStaleTasks: () => Effect.succeed(0),
      isWorktreeDirty: () => Effect.succeed(false),
      processClaimedTask: () =>
        Effect.succeed({ success: true, taskId: "noop", engine: "claude" as const }),
    }

    const controllerDeps: TuiWatchControllerDeps = {
      queryAllTasks: () => Effect.succeed([]),
      queryTaskDetail: () => Effect.succeed(undefined),
      markTaskReady: () => Effect.succeed(undefined),
      tuiWorkerEffect,
      workerDeps,
      loadConfig: () => baseConfig,
    }

    const ctrl = createTuiWatchController(TuiLoggerLayer, {
      refreshIntervalMs: 50,
      workDir: process.cwd(),
      workerId: "tui-remote-test",
      deps: controllerDeps,
    })

    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      ctrl.startWorker()

      // Wait for the worker to poll at least once
      const start = Date.now()
      while (pollCount < 1 && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10))
      }
      await new Promise((r) => setTimeout(r, 50))

      // stderr must be clean
      expect(stderrOutput).not.toContain("tui-worker-remote-check")

      // Remote buffer should have the log from the worker
      const buf = _getBufferForTesting()
      expect(buf.some((e) => String(e.message).includes("tui-worker-remote-check"))).toBe(true)
    } finally {
      console.error = originalConsoleError
      await ctrl.stop()
    }
  })
})

// ===========================================================================
// 5. AppLoggerLayer (run mode) fail-open: remote issues don't break execution
// ===========================================================================

describe("Run mode (AppLoggerLayer) fail-open with remote logger", () => {
  test("AppLoggerLayer logs work when remote is configured but no network call needed", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()

    const issue = makeIssue("RUN-1", "Run mode task")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result.success).toBe(true)

    // Both file and remote should have the milestone
    const buf = _getBufferForTesting()
    expect(buf.some((e) => String(e.message).includes("Task completed"))).toBe(true)

    // File should also exist
    const fs = require("node:fs")
    const path = require("node:path")
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)
    expect(fs.existsSync(logFile)).toBe(true)
  })

  test("AppLoggerLayer logs work with remote unconfigured — local-only fallback", async () => {
    // No AXIOM env vars
    const issue = makeIssue("RUN-2", "Local only run")
    engineResult = Effect.succeed({ response: "done" })

    const result = await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(AppLoggerLayer),
      ),
    )

    expect(result.success).toBe(true)
    expect(_getBufferForTesting()).toHaveLength(0)

    // File should still exist
    const fs = require("node:fs")
    const path = require("node:path")
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)
    expect(fs.existsSync(logFile)).toBe(true)
  })
})

// ===========================================================================
// 6. Remote log level policy stability across all milestone levels
// ===========================================================================

describe("Remote log level policy stability", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("fatal-level logs are remote-eligible", async () => {
    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      Effect.logFatal("catastrophic-failure").pipe(Effect.provide(layer)),
    )

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(1)
    expect(buf[0]!.level).toBe("FATAL")
    expect(buf[0]!.message).toBe("catastrophic-failure")
  })

  test("all four remote-eligible levels ship in a single workflow", async () => {
    // Simulate a workflow that emits info, warn, error, and fatal
    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    const program = Effect.gen(function* () {
      yield* Effect.logInfo("watcher-started")
      yield* Effect.logWarning("worktree-dirty")
      yield* Effect.logError("check-failed")
      yield* Effect.logFatal("unrecoverable")
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(4)
    expect(buf.map((e) => e.level)).toEqual(["INFO", "WARN", "ERROR", "FATAL"])
  })

  test("debug and trace levels are excluded even when interleaved with eligible levels", async () => {
    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    const program = Effect.gen(function* () {
      yield* Effect.logDebug("pre-poll-detail")
      yield* Effect.logInfo("task-claimed")
      yield* Effect.logTrace("micro-detail")
      yield* Effect.logWarning("retry-warning")
      yield* Effect.logDebug("post-execute-detail")
      yield* Effect.logError("check-error")
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(3)
    expect(buf.map((e) => e.level)).toEqual(["INFO", "WARN", "ERROR"])
    expect(buf.map((e) => e.message)).toEqual([
      "task-claimed",
      "retry-warning",
      "check-error",
    ])
  })
})

// ===========================================================================
// 7. Milestone annotation forwarding in workflow context
// ===========================================================================

describe("Milestone annotation forwarding through workflow", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("processClaimedTask milestones carry issue.id from taskId annotation", async () => {
    const issue = makeIssue("ANN-1", "Annotated milestone")
    engineResult = Effect.succeed({ response: "done" })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(layer),
      ),
    )

    const buf = _getBufferForTesting()
    // All entries from processClaimedTask should have issue.id
    for (const entry of buf) {
      expect(entry["issue.id"]).toBe("ANN-1")
    }
  })

  test("disallowed fields (issueTitle) from workflow annotations do not leak to remote", async () => {
    const issue = makeIssue("ANN-2", "Secret Title Should Not Ship")
    engineResult = Effect.succeed({ response: "done" })

    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    await Effect.runPromise(
      processClaimedTask(issue, baseConfig, "w-1", makeWorkflowDeps()).pipe(
        Effect.provide(layer),
      ),
    )

    const buf = _getBufferForTesting()
    for (const entry of buf) {
      // issueTitle is annotated by processClaimedTask but must be excluded
      expect(entry.issueTitle).toBeUndefined()
    }
  })

  test("workerId annotation from watcher context forwards to remote entries", async () => {
    const remoteLogger = getRemoteLogger()
    const layer = Logger.replace(Logger.defaultLogger, remoteLogger)

    // Simulate the annotation pattern from watcher.ts
    const program = Effect.logInfo("Beads watcher starting").pipe(
      Effect.annotateLogs({ workerId: "ralphe-host-1" }),
    )

    await Effect.runPromise(program.pipe(Effect.provide(layer)))

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(1)
    expect(buf[0]!.workerId).toBe("ralphe-host-1")
  })
})
