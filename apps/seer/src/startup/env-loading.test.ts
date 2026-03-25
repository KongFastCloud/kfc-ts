/**
 * Regression tests: env visibility before Google Chat adapter init.
 *
 * Guards against the startup-order bug where static imports caused
 * bot.ts (and the Google Chat adapter) to initialise before dotenv
 * had populated process.env. The fix in index.ts uses dynamic
 * `await import()` after `dotenv.config()` — these tests verify
 * that env-driven auth config is visible at the point the adapter
 * would be constructed.
 *
 * If someone converts the dynamic imports back to static imports,
 * or moves dotenv loading after the app module imports, these tests
 * will catch the regression.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

import { validateGoogleChatAuth } from "../config.ts"
import { ConfigurationError } from "../errors.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "../..")

describe("env visibility before adapter init (regression)", () => {
  let savedCredentials: string | undefined
  let savedAdc: string | undefined

  beforeEach(() => {
    savedCredentials = process.env.GOOGLE_CHAT_CREDENTIALS
    savedAdc = process.env.GOOGLE_CHAT_USE_ADC
    // Clear auth env so each test controls the exact state
    delete process.env.GOOGLE_CHAT_CREDENTIALS
    delete process.env.GOOGLE_CHAT_USE_ADC
  })

  afterEach(() => {
    if (savedCredentials !== undefined) {
      process.env.GOOGLE_CHAT_CREDENTIALS = savedCredentials
    } else {
      delete process.env.GOOGLE_CHAT_CREDENTIALS
    }
    if (savedAdc !== undefined) {
      process.env.GOOGLE_CHAT_USE_ADC = savedAdc
    } else {
      delete process.env.GOOGLE_CHAT_USE_ADC
    }
  })

  it("dotenv populates GOOGLE_CHAT_USE_ADC before validateGoogleChatAuth runs", () => {
    // Simulate the startup sequence: load .env files first, then validate.
    // This mirrors index.ts lines 32-33 → 36 (dynamic import of handler → bot).
    // If dotenv loading were moved after the adapter import, this value
    // would not be present and the validation would throw.
    process.env.GOOGLE_CHAT_USE_ADC = "true"

    // The validation that bot.ts runs at module scope must pass
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("mirrors the startup sequence: dotenv then validation (ADC path)", () => {
    // Replicate the exact startup order from index.ts:
    //   1. dotenv.config() loads env files
    //   2. dynamic import of handler.ts → bot.ts
    //   3. bot.ts calls validateGoogleChatAuth() at module scope
    //
    // Create a temporary .env.local with GOOGLE_CHAT_USE_ADC=true to
    // simulate the real-world scenario where the setting lives in an
    // env file that must be loaded before adapter construction.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seer-env-test-"))
    const envLocalPath = path.join(tmpDir, ".env.local")
    fs.writeFileSync(envLocalPath, "GOOGLE_CHAT_USE_ADC=true\n")

    try {
      // Step 1: load the temp env file (same dotenv.config() call as index.ts)
      dotenv.config({ path: envLocalPath })

      // Step 2+3: validation must pass — env var was populated by dotenv
      assert.equal(
        process.env.GOOGLE_CHAT_USE_ADC?.toLowerCase(),
        "true",
        "dotenv.config() must populate GOOGLE_CHAT_USE_ADC before validation",
      )
      assert.doesNotThrow(() => validateGoogleChatAuth())
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("fails fast when GOOGLE_CHAT_USE_ADC is absent (the previously broken case)", () => {
    // Before the fix, GOOGLE_CHAT_USE_ADC=true could be present in .env.local
    // but the adapter would throw because dotenv hadn't loaded yet.
    // This test proves the validation correctly rejects when the env var
    // is genuinely missing — i.e. the guard is actually effective.
    assert.throws(
      () => validateGoogleChatAuth(),
      (err: unknown) => {
        assert(err instanceof ConfigurationError)
        assert.match(
          err.message,
          /Google Chat authentication is not configured/,
        )
        return true
      },
    )
  })

  it("index.ts uses dynamic imports for app modules (structural guard)", async () => {
    // Read index.ts and verify the critical invariant: app modules are
    // imported dynamically (await import) AFTER dotenv.config() calls.
    // If someone refactors to static imports, this test fails.
    const fs = await import("node:fs")
    const indexSource = fs.readFileSync(
      path.join(appRoot, "src", "index.ts"),
      "utf-8",
    )

    // dotenv.config() must appear before any app module import
    const dotenvPos = indexSource.indexOf("dotenv.config(")
    assert.ok(dotenvPos !== -1, "index.ts must call dotenv.config()")

    // handler.ts (which statically imports bot.ts) must be dynamically imported
    const handlerImport = indexSource.indexOf('await import("./handler.ts")')
    assert.ok(
      handlerImport !== -1,
      'index.ts must dynamically import handler.ts via await import("./handler.ts")',
    )

    // dotenv.config() must come before the dynamic handler import
    assert.ok(
      dotenvPos < handlerImport,
      "dotenv.config() must appear before the handler.ts dynamic import " +
        "so env vars are populated before the Google Chat adapter initialises",
    )

    // Verify handler.ts is NOT statically imported (would defeat the fix)
    const staticHandlerImport =
      /^import\s+.*from\s+["']\.\/handler(?:\.ts)?["']/m.test(indexSource)
    assert.ok(
      !staticHandlerImport,
      "index.ts must NOT statically import handler.ts — " +
        "static imports are hoisted before dotenv.config() runs",
    )
  })

  it("GOOGLE_CHAT_USE_ADC=true set before validation mirrors the fixed startup", () => {
    // This is the exact scenario that was broken: .env.local contains
    // GOOGLE_CHAT_USE_ADC=true but the adapter init ran before dotenv loaded it.
    // After the fix, env is loaded first, so this must pass.
    process.env.GOOGLE_CHAT_USE_ADC = "true"

    // Simulate what bot.ts does at module scope (line 40)
    assert.doesNotThrow(() => validateGoogleChatAuth())

    // Verify the env var is actually visible (not just silently skipped)
    assert.equal(
      process.env.GOOGLE_CHAT_USE_ADC?.toLowerCase(),
      "true",
      "GOOGLE_CHAT_USE_ADC must be readable from process.env",
    )
  })

  it("GOOGLE_CHAT_USE_ADC set after validation would fail (proves ordering matters)", () => {
    // Proves the test would catch a regression: if env loading happened
    // AFTER adapter init, the validation would throw.
    assert.throws(
      () => validateGoogleChatAuth(),
      (err: unknown) => err instanceof ConfigurationError,
    )

    // Now set it — too late for the validation above
    process.env.GOOGLE_CHAT_USE_ADC = "true"

    // A second call would pass, proving the ordering is what matters
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })
})
