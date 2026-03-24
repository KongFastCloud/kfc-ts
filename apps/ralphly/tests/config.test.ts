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
  delete process.env.RALPHLY_WORKSPACE_PATH
  delete process.env.RALPHLY_REPO_PATH
  delete process.env.LINEAR_API_KEY
  delete process.env.LINEAR_AGENT_ID
})

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.RALPHLY_WORKSPACE_PATH
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
        workspacePath: "/tmp/my-workspace",
        linear: { apiKey: "lin_api_test123", agentId: "agent-abc" },
        maxAttempts: 3,
        checks: ["pnpm typecheck"],
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/my-workspace")
      expect(result.config.linear.apiKey).toBe("lin_api_test123")
      expect(result.config.linear.agentId).toBe("agent-abc")
      expect(result.config.maxAttempts).toBe(3)
      expect(result.config.checks).toEqual(["pnpm typecheck"])
    }
  })

  test("env vars override config file values", () => {
    saveConfig(
      {
        workspacePath: "/tmp/file-workspace",
        linear: { apiKey: "lin_api_file", agentId: "agent-file" },
      },
      TEST_DIR,
    )

    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/env-workspace"
    process.env.LINEAR_API_KEY = "lin_api_env"
    process.env.LINEAR_AGENT_ID = "agent-env"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/env-workspace")
      expect(result.config.linear.apiKey).toBe("lin_api_env")
      expect(result.config.linear.agentId).toBe("agent-env")
    }
  })

  test("env vars alone are sufficient (no config file needed)", () => {
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/env-only-workspace"
    process.env.LINEAR_API_KEY = "lin_api_env_only"
    process.env.LINEAR_AGENT_ID = "agent-env-only"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/env-only-workspace")
      expect(result.config.maxAttempts).toBe(2) // default
      expect(result.config.checks).toEqual([]) // default
    }
  })

  test("reports all missing fields at once", () => {
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/partial"
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

// ---------------------------------------------------------------------------
// Backward compatibility: deprecated repoPath / RALPHLY_REPO_PATH
// ---------------------------------------------------------------------------

describe("backward compatibility", () => {
  test("RALPHLY_REPO_PATH env var is accepted as fallback", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/legacy-repo"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/legacy-repo")
    }
  })

  test("repoPath config key is accepted as fallback", () => {
    saveConfig(
      {
        repoPath: "/tmp/legacy-config-repo",
        linear: { apiKey: "lin_api_test", agentId: "agent-test" },
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/legacy-config-repo")
    }
  })

  test("RALPHLY_WORKSPACE_PATH takes precedence over RALPHLY_REPO_PATH", () => {
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/new-workspace"
    process.env.RALPHLY_REPO_PATH = "/tmp/old-repo"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/new-workspace")
    }
  })

  test("workspacePath config key takes precedence over repoPath", () => {
    saveConfig(
      {
        workspacePath: "/tmp/new-workspace",
        repoPath: "/tmp/old-repo",
        linear: { apiKey: "lin_api_test", agentId: "agent-test" },
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/new-workspace")
    }
  })

  test("emits deprecation warning when RALPHLY_REPO_PATH is used", () => {
    process.env.RALPHLY_REPO_PATH = "/tmp/legacy-repo"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain("RALPHLY_REPO_PATH")
      expect(result.warnings[0]).toContain("deprecated")
    }
  })

  test("emits deprecation warning when repoPath config key is used", () => {
    saveConfig(
      {
        repoPath: "/tmp/legacy-config-repo",
        linear: { apiKey: "lin_api_test", agentId: "agent-test" },
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain("repoPath")
      expect(result.warnings[0]).toContain("deprecated")
    }
  })

  test("no deprecation warning when new names are used", () => {
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/new-workspace"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.length).toBe(0)
    }
  })

  test("no deprecation warning when new name overrides deprecated alias", () => {
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/new-workspace"
    process.env.RALPHLY_REPO_PATH = "/tmp/old-repo"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.length).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Workspace independence from launch directory
// ---------------------------------------------------------------------------

describe("workspace is independent of launch directory", () => {
  test("configured workspace path is used regardless of workDir", () => {
    // Config file is in TEST_DIR, but workspace points elsewhere
    saveConfig(
      {
        workspacePath: "/tmp/target-workspace",
        linear: { apiKey: "lin_api_test", agentId: "agent-test" },
      },
      TEST_DIR,
    )

    const result = loadConfig(TEST_DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Workspace is the configured value, not TEST_DIR
      expect(result.config.workspacePath).toBe("/tmp/target-workspace")
      expect(result.config.workspacePath).not.toBe(TEST_DIR)
    }
  })

  test("env-var workspace works without any config file", () => {
    // No config file exists in TEST_DIR, but env vars are set
    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/remote-workspace"
    process.env.LINEAR_API_KEY = "lin_api_test"
    process.env.LINEAR_AGENT_ID = "agent-test"

    // Load from a directory with no config file
    const emptyDir = path.join(TEST_DIR, "empty-subdir")
    fs.mkdirSync(emptyDir, { recursive: true })

    const result = loadConfig(emptyDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/remote-workspace")
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
    saveConfig({ workspacePath: "/tmp/test" }, TEST_DIR)
    const configPath = getConfigPath(TEST_DIR)
    expect(fs.existsSync(configPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(content.workspacePath).toBe("/tmp/test")
  })
})
