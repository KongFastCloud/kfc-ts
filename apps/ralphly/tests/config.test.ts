/**
 * ABOUTME: Tests for ralphly configuration loading.
 * Verifies config file loading, env var overrides, and validation of required fields.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { loadConfig, saveConfig, getConfigPath } from "../src/config.js"

const TEST_DIR = path.join(import.meta.dir, ".tmp-test-workspace")

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true })
  // Clear env vars
  delete process.env.RALPHLY_REPO_PATH
  delete process.env.LINEAR_API_KEY
  delete process.env.LINEAR_AGENT_ID
})

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.RALPHLY_REPO_PATH
  delete process.env.LINEAR_API_KEY
  delete process.env.LINEAR_AGENT_ID
})

describe("loadConfig", () => {
  test("returns error when no config file and no env vars", () => {
    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing.length).toBe(3)
    }
  })

  test("loads config from file", () => {
    saveConfig(
      {
        repoPath: "/tmp/my-repo",
        linear: { apiKey: "lin_api_test123", agentId: "agent-abc" },
        maxAttempts: 3,
        checks: ["pnpm typecheck"],
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/my-repo")
      expect(result.config.linear.apiKey).toBe("lin_api_test123")
      expect(result.config.linear.agentId).toBe("agent-abc")
      expect(result.config.maxAttempts).toBe(3)
      expect(result.config.checks).toEqual(["pnpm typecheck"])
    }
  })

  test("env vars override config file values", () => {
    saveConfig(
      {
        repoPath: "/tmp/file-repo",
        linear: { apiKey: "lin_api_file", agentId: "agent-file" },
      },
      TEST_DIR,
    )

    process.env.RALPHLY_REPO_PATH = "/tmp/env-repo"
    process.env.LINEAR_API_KEY = "lin_api_env"
    process.env.LINEAR_AGENT_ID = "agent-env"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/env-repo")
      expect(result.config.linear.apiKey).toBe("lin_api_env")
      expect(result.config.linear.agentId).toBe("agent-env")
    }
  })

  test("env vars alone are sufficient (no config file needed)", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/env-only-repo"
    process.env.LINEAR_API_KEY = "lin_api_env_only"
    process.env.LINEAR_AGENT_ID = "agent-env-only"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.repoPath).toBe("/tmp/env-only-repo")
      expect(result.config.maxAttempts).toBe(2) // default
      expect(result.config.checks).toEqual([]) // default
    }
  })

  test("reports all missing fields at once", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/partial"
    // Missing: LINEAR_API_KEY, LINEAR_AGENT_ID

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing.length).toBe(2)
      expect(result.error.missing.some((m) => m.includes("apiKey"))).toBe(true)
      expect(result.error.missing.some((m) => m.includes("agentId"))).toBe(true)
    }
  })
})

describe("getConfigPath", () => {
  test("returns path under .ralphly directory", () => {
    const p = getConfigPath("/some/workspace")
    expect(p).toBe("/some/workspace/.ralphly/config.json")
  })
})

describe("saveConfig", () => {
  test("creates config dir and writes file", () => {
    saveConfig({ repoPath: "/tmp/test" }, TEST_DIR)
    const configPath = getConfigPath(TEST_DIR)
    expect(fs.existsSync(configPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(content.repoPath).toBe("/tmp/test")
  })
})
