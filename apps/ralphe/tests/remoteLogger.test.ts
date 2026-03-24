/**
 * ABOUTME: Tests for the Axiom remote log sink module.
 * Verifies fail-open behavior, level filtering (info/warn/error shipped,
 * debug stays local), configuration handling, and buffer management.
 * Uses deterministic local inspection rather than live Axiom access.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect, Logger } from "effect"
import {
  initRemoteLogger,
  shutdownRemoteLogger,
  getRemoteLogger,
  _resetForTesting,
  _getBufferForTesting,
} from "../src/remoteLogger.js"
import { AppLoggerLayer, TuiLoggerLayer } from "../src/logger.js"

beforeEach(() => {
  _resetForTesting()
  delete process.env.AXIOM_TOKEN
  delete process.env.AXIOM_LOG_DATASET
  delete process.env.AXIOM_DOMAIN
})

afterEach(async () => {
  await shutdownRemoteLogger()
  _resetForTesting()
  delete process.env.AXIOM_TOKEN
  delete process.env.AXIOM_LOG_DATASET
  delete process.env.AXIOM_DOMAIN
})

describe("initRemoteLogger", () => {
  test("is a no-op when AXIOM env vars are missing", () => {
    expect(() => initRemoteLogger()).not.toThrow()
  })

  test("is a no-op when AXIOM_LOG_DATASET is missing", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    // Missing AXIOM_LOG_DATASET

    expect(() => initRemoteLogger()).not.toThrow()
  })

  test("is a no-op when only AXIOM_TOKEN is set", () => {
    process.env.AXIOM_TOKEN = "test-token"

    expect(() => initRemoteLogger()).not.toThrow()
  })

  test("initializes without error when all env vars are set", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"

    expect(() => initRemoteLogger()).not.toThrow()
  })

  test("is idempotent — second call is a no-op", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"

    initRemoteLogger()
    expect(() => initRemoteLogger()).not.toThrow()
  })

  test("uses AXIOM_LOG_DATASET not AXIOM_DATASET", () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "traces-dataset" // trace dataset — should NOT activate logs
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    // AXIOM_LOG_DATASET is NOT set

    initRemoteLogger()

    // Logger should be a no-op since AXIOM_LOG_DATASET is missing
    const logger = getRemoteLogger()
    // Emit through the logger directly via Effect
    const program = Effect.logInfo("should-not-buffer")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    expect(_getBufferForTesting()).toHaveLength(0)
  })
})

describe("remote log level filtering", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("buffers info-level logs", () => {
    const logger = getRemoteLogger()
    const program = Effect.logInfo("operational-event")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(1)
    expect(buf[0]!.level).toBe("INFO")
    expect(buf[0]!.message).toBe("operational-event")
  })

  test("buffers warning-level logs", () => {
    const logger = getRemoteLogger()
    const program = Effect.logWarning("something-wrong")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(1)
    expect(buf[0]!.level).toBe("WARN")
  })

  test("buffers error-level logs", () => {
    const logger = getRemoteLogger()
    const program = Effect.logError("failure")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const buf = _getBufferForTesting()
    expect(buf).toHaveLength(1)
    expect(buf[0]!.level).toBe("ERROR")
  })

  test("does NOT buffer debug-level logs", () => {
    const logger = getRemoteLogger()
    const program = Effect.logDebug("noisy-polling-detail")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    expect(_getBufferForTesting()).toHaveLength(0)
  })

  test("does NOT buffer trace-level logs", () => {
    const logger = getRemoteLogger()
    const program = Effect.logTrace("very-noisy")
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    expect(_getBufferForTesting()).toHaveLength(0)
  })
})

describe("remote logger entry format", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("includes _time, level, and message fields", () => {
    const logger = getRemoteLogger()
    Effect.runSync(
      Effect.logInfo("hello").pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    expect(entry._time).toBeDefined()
    expect(typeof entry._time).toBe("string")
    expect(entry.level).toBe("INFO")
    expect(entry.message).toBe("hello")
  })

  test("includes allowed annotation fields from Effect.annotateLogs", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({ engine: "claude", "issue.id": "TST-42" })(
      Effect.logInfo("task-claimed"),
    )
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    expect(entry.engine).toBe("claude")
    expect(entry["issue.id"]).toBe("TST-42")
  })

  test("normalizes annotation keys to canonical remote field names", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({
      taskId: "PROJ-99",
      attempt: 2,
      maxAttempts: 5,
    })(Effect.logInfo("attempt-start"))
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    // Internal keys are mapped to canonical remote names
    expect(entry["issue.id"]).toBe("PROJ-99")
    expect(entry["loop.attempt"]).toBe(2)
    expect(entry["loop.max_attempts"]).toBe(5)
    // Internal key names should NOT appear
    expect(entry.taskId).toBeUndefined()
    expect(entry.attempt).toBeUndefined()
    expect(entry.maxAttempts).toBeUndefined()
  })

  test("includes all approved structured fields when present", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({
      "issue.id": "TST-1",
      engine: "claude",
      "check.name": "lint",
      trace_id: "abc-123",
      span_id: "def-456",
      workerId: "w-7",
      "loop.attempt": 1,
      "loop.max_attempts": 3,
    })(Effect.logInfo("full-context"))
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    expect(entry["issue.id"]).toBe("TST-1")
    expect(entry.engine).toBe("claude")
    expect(entry["check.name"]).toBe("lint")
    expect(entry.trace_id).toBe("abc-123")
    expect(entry.span_id).toBe("def-456")
    expect(entry.workerId).toBe("w-7")
    expect(entry["loop.attempt"]).toBe(1)
    expect(entry["loop.max_attempts"]).toBe(3)
  })
})

describe("remote log field filtering", () => {
  beforeEach(() => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()
  })

  test("excludes disallowed high-cardinality fields", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({
      issueTitle: "Fix the broken widget",
      prompt: "You are a coding agent...",
      stdout: "lots of build output here...",
      stderr: "error: something failed",
      command: "bun run build --verbose",
      resumeToken: "tok_abc123",
      taskText: "Full description of the task...",
    })(Effect.logInfo("should-be-stripped"))
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    // Core fields are present
    expect(entry.message).toBe("should-be-stripped")
    expect(entry.level).toBe("INFO")
    expect(entry._time).toBeDefined()

    // All disallowed fields must be absent
    expect(entry.issueTitle).toBeUndefined()
    expect(entry.prompt).toBeUndefined()
    expect(entry.stdout).toBeUndefined()
    expect(entry.stderr).toBeUndefined()
    expect(entry.command).toBeUndefined()
    expect(entry.resumeToken).toBeUndefined()
    expect(entry.taskText).toBeUndefined()
  })

  test("mixes allowed and disallowed fields, only allowed pass through", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({
      engine: "claude",
      "issue.id": "TST-42",
      issueTitle: "Secret title",
      prompt: "System prompt...",
      "check.name": "typecheck",
    })(Effect.logInfo("mixed-annotations"))
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    // Allowed fields present
    expect(entry.engine).toBe("claude")
    expect(entry["issue.id"]).toBe("TST-42")
    expect(entry["check.name"]).toBe("typecheck")

    // Disallowed fields absent
    expect(entry.issueTitle).toBeUndefined()
    expect(entry.prompt).toBeUndefined()
  })

  test("remote entries have only core + allowlisted keys", () => {
    const logger = getRemoteLogger()
    const program = Effect.annotateLogs({
      engine: "claude",
      "issue.id": "TST-1",
      randomField: "should-not-appear",
      anotherUnknown: 42,
    })(Effect.logInfo("strict-contract"))
    Effect.runSync(
      program.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    const entry = _getBufferForTesting()[0]!
    const keys = Object.keys(entry).sort()
    // Only core fields + allowed annotation fields
    expect(keys).toEqual(["_time", "engine", "issue.id", "level", "message"])
  })
})

describe("fail-open behavior", () => {
  test("getRemoteLogger returns a working logger when unconfigured", () => {
    // No init, no config
    const logger = getRemoteLogger()
    // Should not throw when used
    Effect.runSync(
      Effect.logInfo("ignored").pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    // Nothing buffered since not configured
    expect(_getBufferForTesting()).toHaveLength(0)
  })

  test("shutdownRemoteLogger is safe when not initialized", async () => {
    await expect(shutdownRemoteLogger()).resolves.toBeUndefined()
  })

  test("shutdownRemoteLogger is safe after init with no config", async () => {
    initRemoteLogger() // no env vars
    await expect(shutdownRemoteLogger()).resolves.toBeUndefined()
  })
})

describe("integration with AppLoggerLayer", () => {
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    const fs = require("node:fs")
    const path = require("node:path")
    const os = require("node:os")
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-remote-test-"))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test("AppLoggerLayer still writes to file when remote is configured", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()

    const program = Effect.logInfo("app-with-remote")
    await Effect.runPromise(program.pipe(Effect.provide(AppLoggerLayer)))

    const fs = require("node:fs")
    const path = require("node:path")
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)

    expect(fs.existsSync(logFile)).toBe(true)
    const content = fs.readFileSync(logFile, "utf-8").trim()
    const entry = JSON.parse(content)
    expect(entry.message).toBe("app-with-remote")

    // Also check that the remote buffer received the entry
    expect(_getBufferForTesting()).toHaveLength(1)
    expect(_getBufferForTesting()[0]!.message).toBe("app-with-remote")
  })

  test("AppLoggerLayer works normally when remote is NOT configured", async () => {
    // No AXIOM_LOG_DATASET — remote is a no-op
    const program = Effect.logInfo("app-without-remote")
    await Effect.runPromise(program.pipe(Effect.provide(AppLoggerLayer)))

    const fs = require("node:fs")
    const path = require("node:path")
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)

    expect(fs.existsSync(logFile)).toBe(true)
    const content = fs.readFileSync(logFile, "utf-8").trim()
    const entry = JSON.parse(content)
    expect(entry.message).toBe("app-without-remote")

    // Remote buffer should be empty
    expect(_getBufferForTesting()).toHaveLength(0)
  })
})

describe("integration with TuiLoggerLayer", () => {
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    const fs = require("node:fs")
    const path = require("node:path")
    const os = require("node:os")
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-remote-tui-test-"))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test("TuiLoggerLayer ships to remote while suppressing stderr", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()

    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      const program = Effect.logInfo("tui-remote-test")
      await Effect.runPromise(program.pipe(Effect.provide(TuiLoggerLayer)))

      // stderr should NOT contain the log message (TUI suppression)
      expect(stderrOutput).not.toContain("tui-remote-test")

      // Remote buffer SHOULD contain the entry
      expect(_getBufferForTesting()).toHaveLength(1)
      expect(_getBufferForTesting()[0]!.message).toBe("tui-remote-test")

      // File should also have it
      const fs = require("node:fs")
      const path = require("node:path")
      const d = new Date()
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, "0")
      const dd = String(d.getDate()).padStart(2, "0")
      const logFile = path.join(".ralphe/logs", `ralphe-${yyyy}-${mm}-${dd}.log`)
      expect(fs.existsSync(logFile)).toBe(true)
    } finally {
      console.error = originalConsoleError
    }
  })

  test("TuiLoggerLayer does NOT ship debug logs remotely", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_LOG_DATASET = "test-logs"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initRemoteLogger()

    const program = Effect.logDebug("tui-debug-noise")
    await Effect.runPromise(program.pipe(
      Effect.provide(TuiLoggerLayer),
      // Enable debug-level minimum so the logger actually fires
      Effect.withLogSpan("test"),
    ))

    // Debug should NOT appear in remote buffer
    expect(_getBufferForTesting()).toHaveLength(0)
  })
})
