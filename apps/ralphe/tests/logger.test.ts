/**
 * ABOUTME: Tests for logger layer routing.
 * Owns the contract that TuiLoggerLayer writes JSON-lines to the log file
 * and does NOT emit to stderr, while AppLoggerLayer writes to both file
 * and stderr. These boundaries prevent TUI rendering corruption and ensure
 * headless runs still get visible output.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { AppLoggerLayer, TuiLoggerLayer } from "../src/logger.js"
import * as fs from "node:fs"
import * as path from "node:path"

const LOG_DIR = ".ralphe/logs"

/**
 * Returns today's log file path (mirrors logFileName logic in logger.ts).
 */
const todayLogFile = (): string => {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return path.join(LOG_DIR, `ralphe-${yyyy}-${mm}-${dd}.log`)
}

describe("TuiLoggerLayer", () => {
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    const tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "logger-test-"))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test("writes log entries to the JSON lines file", async () => {
    const program = Effect.logInfo("tui-test-message")

    await Effect.runPromise(program.pipe(Effect.provide(TuiLoggerLayer)))

    const logFile = todayLogFile()
    expect(fs.existsSync(logFile)).toBe(true)

    const content = fs.readFileSync(logFile, "utf-8").trim()
    const entry = JSON.parse(content)
    expect(entry.level).toBe("INFO")
    expect(entry.message).toBe("tui-test-message")
  })

  test("does NOT write to stderr", async () => {
    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      const program = Effect.logInfo("should-not-appear-on-stderr")
      await Effect.runPromise(program.pipe(Effect.provide(TuiLoggerLayer)))

      expect(stderrOutput).not.toContain("should-not-appear-on-stderr")
      expect(stderrOutput).toBe("")
    } finally {
      console.error = originalConsoleError
    }
  })
})

describe("AppLoggerLayer", () => {
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    const tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "logger-test-"))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test("writes to both file and stderr", async () => {
    const originalConsoleError = console.error
    let stderrOutput = ""
    console.error = (...args: unknown[]) => {
      stderrOutput += args.map(String).join(" ")
    }

    try {
      const program = Effect.logInfo("app-logger-test")
      await Effect.runPromise(program.pipe(Effect.provide(AppLoggerLayer)))

      // Verify file output
      const logFile = todayLogFile()
      expect(fs.existsSync(logFile)).toBe(true)
      const content = fs.readFileSync(logFile, "utf-8").trim()
      const entry = JSON.parse(content)
      expect(entry.message).toBe("app-logger-test")

      // Verify stderr output
      expect(stderrOutput).toContain("app-logger-test")
    } finally {
      console.error = originalConsoleError
    }
  })
})
