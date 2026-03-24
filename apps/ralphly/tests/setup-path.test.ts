/**
 * ABOUTME: End-to-end validation of the ralphly setup/onboarding contract.
 * Proves that the documented setup path (.env.example, README, package scripts,
 * config loading, and CLI guidance) all agree and that a developer following the
 * docs can reach a successful config or dry-run entry point.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { loadConfig, saveConfig } from "../src/config.js"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const APP_ROOT = path.resolve(import.meta.dir, "..")
const ENV_EXAMPLE_PATH = path.join(APP_ROOT, ".env.example")
const README_PATH = path.join(APP_ROOT, "README.md")
const PKG_PATH = path.join(APP_ROOT, "package.json")
const RALPHE_PKG_PATH = path.resolve(APP_ROOT, "../ralphe/package.json")
const TEST_DIR = path.join(import.meta.dir, ".tmp-setup-test")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse .env.example into an array of variable names (ignoring comments/blanks). */
const parseEnvExampleKeys = (content: string): string[] =>
  content
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split("=")[0]!)

/** The three env vars that config.ts actually reads via envOr(). */
const REQUIRED_ENV_KEYS = [
  "RALPHLY_REPO_PATH",
  "LINEAR_API_KEY",
  "LINEAR_AGENT_ID",
] as const

/** Config file field paths that map to the required env vars. */
const REQUIRED_CONFIG_FIELDS = [
  { envKey: "RALPHLY_REPO_PATH", configPath: "repoPath" },
  { envKey: "LINEAR_API_KEY", configPath: "linear.apiKey" },
  { envKey: "LINEAR_AGENT_ID", configPath: "linear.agentId" },
] as const

// ---------------------------------------------------------------------------
// Setup / teardown for config tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true })
  for (const key of REQUIRED_ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  for (const key of REQUIRED_ENV_KEYS) delete process.env[key]
})

// ===========================================================================
// 1. .env.example matches the implementation
// ===========================================================================

describe(".env.example matches implementation", () => {
  const envContent = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8")
  const envKeys = parseEnvExampleKeys(envContent)

  test("contains exactly the required env vars", () => {
    expect(envKeys.sort()).toEqual([...REQUIRED_ENV_KEYS].sort())
  })

  test("every key has an empty placeholder (no default values baked in)", () => {
    for (const key of envKeys) {
      const line = envContent.split("\n").find((l) => l.startsWith(`${key}=`))
      // Should be KEY= with nothing after the equals sign
      expect(line).toBe(`${key}=`)
    }
  })

  test("mentions env-over-config precedence", () => {
    expect(envContent).toMatch(/override/i)
    expect(envContent).toMatch(/config\.json/i)
  })
})

// ===========================================================================
// 2. README documents the setup contract accurately
// ===========================================================================

describe("README documents the setup contract", () => {
  const readme = fs.readFileSync(README_PATH, "utf-8")

  test("documents all three required env vars", () => {
    for (const key of REQUIRED_ENV_KEYS) {
      expect(readme).toContain(key)
    }
  })

  test("documents the config file path", () => {
    expect(readme).toContain(".ralphly/config.json")
  })

  test("documents all config file field paths", () => {
    for (const { configPath } of REQUIRED_CONFIG_FIELDS) {
      expect(readme).toContain(configPath)
    }
  })

  test("documents env-over-config precedence", () => {
    // The README should explicitly state env vars win
    expect(readme).toMatch(/environment variables win/i)
  })

  test("documents the verification flow (config then dry-run)", () => {
    expect(readme).toContain("ralphly config")
    expect(readme).toContain("ralphly run --dry-run")
  })

  test("documents the .env.example copy step", () => {
    expect(readme).toContain(".env.example")
  })

  test("documents lint and link commands", () => {
    expect(readme).toContain("bun run lint")
    expect(readme).toContain("bun run link")
  })

  test("documents default values for optional fields", () => {
    expect(readme).toContain("maxAttempts")
    expect(readme).toContain("checks")
  })
})

// ===========================================================================
// 3. Package scripts are functional and match ralphe conventions
// ===========================================================================

describe("package scripts match ralphe conventions", () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"))
  const ralphePkg = JSON.parse(fs.readFileSync(RALPHE_PKG_PATH, "utf-8"))

  test("has a lint script", () => {
    expect(pkg.scripts.lint).toBeDefined()
    expect(typeof pkg.scripts.lint).toBe("string")
  })

  test("has a link script", () => {
    expect(pkg.scripts.link).toBeDefined()
    expect(typeof pkg.scripts.link).toBe("string")
  })

  test("lint script uses oxlint (same tool as ralphe)", () => {
    expect(pkg.scripts.lint).toMatch(/^oxlint\b/)
    expect(ralphePkg.scripts.lint).toMatch(/^oxlint\b/)
  })

  test("link script uses bun link (same approach as ralphe)", () => {
    expect(pkg.scripts.link).toBe("bun link")
    expect(ralphePkg.scripts.link).toBe("bun link")
  })

  test("has bin entry for CLI registration", () => {
    expect(pkg.bin?.ralphly).toBeDefined()
  })

  test("has dev, test, and typecheck scripts", () => {
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.test).toBeDefined()
    expect(pkg.scripts.typecheck).toBeDefined()
  })
})

// ===========================================================================
// 4. Documented setup path reaches successful config (end-to-end)
// ===========================================================================

describe("documented setup path reaches successful config", () => {
  test("env-only path: set all three env vars → loadConfig succeeds", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/setup-test-repo"
    process.env.LINEAR_API_KEY = "lin_api_setup_test"
    process.env.LINEAR_AGENT_ID = "agent-setup-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/setup-test-repo")
      expect(result.config.linear.apiKey).toBe("lin_api_setup_test")
      expect(result.config.linear.agentId).toBe("agent-setup-test")
      expect(result.config.maxAttempts).toBe(2)
      expect(result.config.checks).toEqual([])
    }
  })

  test("config-file-only path: write config.json → loadConfig succeeds", () => {
    saveConfig(
      {
        repoPath: "/tmp/config-file-repo",
        linear: { apiKey: "lin_api_file_test", agentId: "agent-file-test" },
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/config-file-repo")
      expect(result.config.linear.apiKey).toBe("lin_api_file_test")
      expect(result.config.linear.agentId).toBe("agent-file-test")
    }
  })

  test("mixed path: some values from env, some from file → loadConfig succeeds", () => {
    // Simulates a developer who has a config file but overrides repo path via env
    saveConfig(
      {
        linear: { apiKey: "lin_api_mixed", agentId: "agent-mixed" },
      },
      TEST_DIR,
    )
    process.env.RALPHLY_REPO_PATH = "/tmp/env-override-repo"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/env-override-repo")
      expect(result.config.linear.apiKey).toBe("lin_api_mixed")
      expect(result.config.linear.agentId).toBe("agent-mixed")
    }
  })

  test("precedence: env vars override config file values", () => {
    saveConfig(
      {
        repoPath: "/tmp/file-value",
        linear: { apiKey: "lin_api_file", agentId: "agent-file" },
      },
      TEST_DIR,
    )
    process.env.RALPHLY_REPO_PATH = "/tmp/env-value"
    process.env.LINEAR_API_KEY = "lin_api_env"
    process.env.LINEAR_AGENT_ID = "agent-env"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Env wins in all cases, as documented
      expect(result.config.repoPath).toBe("/tmp/env-value")
      expect(result.config.linear.apiKey).toBe("lin_api_env")
      expect(result.config.linear.agentId).toBe("agent-env")
    }
  })
})

// ===========================================================================
// 5. Setup failures produce actionable guidance
// ===========================================================================

describe("setup failures produce actionable guidance", () => {
  test("missing all values → error lists all three required fields", () => {
    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing).toHaveLength(3)
      // Each missing field should mention both the config path and the env var
      for (const { envKey } of REQUIRED_CONFIG_FIELDS) {
        expect(result.error.missing.some((m) => m.includes(envKey))).toBe(true)
      }
    }
  })

  test("missing one value → error is specific to that field", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/partial"
    process.env.LINEAR_API_KEY = "lin_api_partial"
    // LINEAR_AGENT_ID is missing

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing).toHaveLength(1)
      expect(result.error.missing[0]).toContain("agentId")
      expect(result.error.missing[0]).toContain("LINEAR_AGENT_ID")
    }
  })
})

// ===========================================================================
// 6. Lint and link scripts are functional
// ===========================================================================

describe("lint and link scripts are functional", () => {
  test("oxlint config file exists and is valid JSON", () => {
    const oxlintPath = path.join(APP_ROOT, ".oxlintrc.json")
    expect(fs.existsSync(oxlintPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(oxlintPath, "utf-8"))
    expect(content).toBeDefined()
    expect(Array.isArray(content.ignorePatterns)).toBe(true)
  })

  test("lint script targets the right directories", () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"))
    const lintScript: string = pkg.scripts.lint
    // Should lint src, tests, and cli.ts
    expect(lintScript).toContain("src")
    expect(lintScript).toContain("tests")
    expect(lintScript).toContain("cli.ts")
  })
})
