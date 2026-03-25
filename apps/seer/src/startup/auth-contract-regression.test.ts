/**
 * Regression tests: Google Chat auth setup contract.
 *
 * Ensures the documented auth contract (README, .env.example) stays in
 * sync with the runtime requirements (config.ts validation, bot.ts
 * startup). If someone changes the env var names, drops a doc section,
 * or alters the validation logic, these tests catch the drift.
 *
 * Scope is intentionally limited to setup surfaces and startup-validation
 * behavior — adapter SDK integration is covered elsewhere.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { validateGoogleChatAuth } from "../config.ts"
import { ConfigurationError } from "../errors.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "../..")

// ── Helpers ────────────────────────────────────────────────────────

function readSetupFile(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf-8")
}

// ── Auth env vars that the runtime requires ────────────────────────

const REQUIRED_AUTH_VARS = [
  "GOOGLE_CHAT_CREDENTIALS",
  "GOOGLE_CHAT_USE_ADC",
] as const

// ====================================================================
// 1. Docs and env examples include the required auth env vars
// ====================================================================

describe("setup surfaces document the auth contract", () => {
  let envExample: string
  let readme: string

  beforeEach(() => {
    envExample = readSetupFile(".env.example")
    readme = readSetupFile("README.md")
  })

  for (const varName of REQUIRED_AUTH_VARS) {
    it(`.env.example mentions ${varName}`, () => {
      assert.ok(
        envExample.includes(varName),
        `.env.example must reference ${varName} so operators know to set it`,
      )
    })

    it(`README.md mentions ${varName}`, () => {
      assert.ok(
        readme.includes(varName),
        `README.md must reference ${varName} so operators know to set it`,
      )
    })
  }

  it(".env.example documents both auth options (A and B)", () => {
    assert.match(
      envExample,
      /Option A/i,
      ".env.example must describe Option A (service account credentials)",
    )
    assert.match(
      envExample,
      /Option B/i,
      ".env.example must describe Option B (Application Default Credentials)",
    )
  })

  it("README.md has a Google Chat authentication section", () => {
    assert.match(
      readme,
      /### Authentication/,
      "README.md must have an Authentication subsection under Google Chat Setup",
    )
  })

  it("README.md documents both auth options (A and B)", () => {
    assert.match(
      readme,
      /Option A.*Service account/i,
      "README.md must describe Option A (service account credentials)",
    )
    assert.match(
      readme,
      /Option B.*Application Default Credentials/i,
      "README.md must describe Option B (ADC)",
    )
  })

  it("README.md documents that missing auth causes startup failure", () => {
    // The Environment section should warn about the startup failure mode
    assert.match(
      readme,
      /fail.*start|startup.*fail/i,
      "README.md must warn that missing auth causes a startup failure",
    )
  })

  it(".env.example documents that missing auth causes startup failure", () => {
    assert.match(
      envExample,
      /fail.*start|startup.*fail/i,
      ".env.example must warn that missing auth causes a startup failure",
    )
  })

  it("README.md references .env.example for auth setup", () => {
    assert.match(
      readme,
      /\.env\.example/,
      "README.md should reference .env.example so operators know where to configure auth",
    )
  })
})

// ====================================================================
// 2. Missing-auth startup failure is clear and actionable
// ====================================================================

describe("missing-auth startup failure is clear and actionable", () => {
  let savedCredentials: string | undefined
  let savedAdc: string | undefined

  beforeEach(() => {
    savedCredentials = process.env.GOOGLE_CHAT_CREDENTIALS
    savedAdc = process.env.GOOGLE_CHAT_USE_ADC
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

  it("throws ConfigurationError (not a raw SDK error)", () => {
    assert.throws(
      () => validateGoogleChatAuth(),
      (err: unknown) => {
        assert(
          err instanceof ConfigurationError,
          `Expected ConfigurationError, got ${(err as Error)?.constructor?.name}`,
        )
        return true
      },
    )
  })

  it("error message names both auth options so operators know what to set", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      for (const varName of REQUIRED_AUTH_VARS) {
        assert.match(
          err.message,
          new RegExp(varName),
          `Error message must mention ${varName}`,
        )
      }
    }
  })

  it("error message includes setup guidance (references README and .env.example)", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      assert.match(
        err.message,
        /README\.md/,
        "Error message must reference README.md for full setup instructions",
      )
      assert.match(
        err.message,
        /\.env\.example/,
        "Error message must reference .env.example for configuration template",
      )
    }
  })

  it("error message describes Option A (service account credentials)", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      assert.match(
        err.message,
        /[Ss]ervice account/,
        "Error message must describe the service account option",
      )
    }
  })

  it("error message describes Option B (Application Default Credentials)", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      assert.match(
        err.message,
        /Application Default Credentials|GOOGLE_CHAT_USE_ADC=true/,
        "Error message must describe the ADC option",
      )
    }
  })
})

// ====================================================================
// 3. Startup success-path coverage
// ====================================================================

describe("startup success path with valid auth config", () => {
  let savedCredentials: string | undefined
  let savedAdc: string | undefined

  beforeEach(() => {
    savedCredentials = process.env.GOOGLE_CHAT_CREDENTIALS
    savedAdc = process.env.GOOGLE_CHAT_USE_ADC
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

  it("passes validation with GOOGLE_CHAT_CREDENTIALS alone", () => {
    process.env.GOOGLE_CHAT_CREDENTIALS =
      '{"type":"service_account","project_id":"test"}'
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("passes validation with GOOGLE_CHAT_USE_ADC=true alone", () => {
    process.env.GOOGLE_CHAT_USE_ADC = "true"
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("passes validation when both auth options are set", () => {
    process.env.GOOGLE_CHAT_CREDENTIALS =
      '{"type":"service_account","project_id":"test"}'
    process.env.GOOGLE_CHAT_USE_ADC = "true"
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("rejects GOOGLE_CHAT_USE_ADC set to a non-true value", () => {
    process.env.GOOGLE_CHAT_USE_ADC = "yes"
    assert.throws(
      () => validateGoogleChatAuth(),
      (err: unknown) => err instanceof ConfigurationError,
      "ADC must be exactly 'true' (case-insensitive), not other truthy values",
    )
  })

  it("rejects empty GOOGLE_CHAT_CREDENTIALS", () => {
    process.env.GOOGLE_CHAT_CREDENTIALS = ""
    assert.throws(
      () => validateGoogleChatAuth(),
      (err: unknown) => err instanceof ConfigurationError,
      "Empty credentials string should not pass validation",
    )
  })
})

// ====================================================================
// 4. Structural: bot.ts calls validateGoogleChatAuth before adapter init
// ====================================================================

describe("bot.ts validates auth before adapter construction (structural)", () => {
  it("calls validateGoogleChatAuth() before createGoogleChatAdapter()", () => {
    const botSource = readSetupFile("src/bot.ts")

    const validatePos = botSource.indexOf("validateGoogleChatAuth()")
    assert.ok(
      validatePos !== -1,
      "bot.ts must call validateGoogleChatAuth()",
    )

    const adapterPos = botSource.indexOf("createGoogleChatAdapter()")
    assert.ok(
      adapterPos !== -1,
      "bot.ts must call createGoogleChatAdapter()",
    )

    assert.ok(
      validatePos < adapterPos,
      "validateGoogleChatAuth() must be called before createGoogleChatAdapter() " +
        "so operators see an actionable message instead of a raw SDK exception",
    )
  })

  it("wraps adapter construction errors in ConfigurationError", () => {
    const botSource = readSetupFile("src/bot.ts")

    // The try/catch around createGoogleChatAdapter should re-throw as ConfigurationError
    assert.match(
      botSource,
      /try\s*\{[\s\S]*?createGoogleChatAdapter\(\)[\s\S]*?\}\s*catch/,
      "bot.ts must wrap createGoogleChatAdapter() in a try/catch",
    )
    assert.match(
      botSource,
      /new ConfigurationError/,
      "bot.ts catch block must throw a ConfigurationError with guidance",
    )
  })
})

// ====================================================================
// 5. Structural: validation error message stays in sync with docs
// ====================================================================

describe("validation error references match actual setup file locations", () => {
  let savedCredentials: string | undefined
  let savedAdc: string | undefined

  beforeEach(() => {
    savedCredentials = process.env.GOOGLE_CHAT_CREDENTIALS
    savedAdc = process.env.GOOGLE_CHAT_USE_ADC
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

  it("README.md referenced in error message actually exists", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      // Extract the README path reference from the error message
      assert.match(err.message, /README\.md/)

      // Verify the README actually exists at the expected location
      assert.ok(
        fs.existsSync(path.join(appRoot, "README.md")),
        "README.md referenced in error message must exist in the app root",
      )
    }
  })

  it(".env.example referenced in error message actually exists", () => {
    try {
      validateGoogleChatAuth()
      assert.fail("Expected validateGoogleChatAuth to throw")
    } catch (err: unknown) {
      assert(err instanceof ConfigurationError)
      assert.match(err.message, /\.env\.example/)

      assert.ok(
        fs.existsSync(path.join(appRoot, ".env.example")),
        ".env.example referenced in error message must exist in the app root",
      )
    }
  })
})
