import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// @ts-expect-error Bun test isolation import suffix is runtime-only.
const configModule = await import("../src/config.js?configTest") as typeof import("../src/config.js")
const {
  loadConfig,
  saveConfig,
  getConfigPath,
  parseGitMode,
} = configModule

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-config-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true })
})

describe("loadConfig", () => {
  test("returns defaults when no config exists", () => {
    const config = loadConfig(tmpDir)
    expect(config).toEqual({
      engine: "claude",
      maxAttempts: 2,
      checks: [],
      git: { mode: "none" },
      report: "none",
    })
  })

  test("loads config from file", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ engine: "codex", maxAttempts: 3, checks: ["npm test"] }),
    )
    const config = loadConfig(tmpDir)
    expect(config.engine).toBe("codex")
    expect(config.maxAttempts).toBe(3)
    expect(config.checks).toEqual(["npm test"])
  })

  test("fills missing fields with defaults", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ checks: ["make test"] }),
    )
    const config = loadConfig(tmpDir)
    expect(config.engine).toBe("claude")
    expect(config.maxAttempts).toBe(2)
    expect(config.checks).toEqual(["make test"])
  })

  test("returns defaults on invalid JSON", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "config.json"), "not json")
    const config = loadConfig(tmpDir)
    expect(config).toEqual({
      engine: "claude",
      maxAttempts: 2,
      checks: [],
      git: { mode: "none" },
      report: "none",
    })
  })

  test("reads canonical git.mode directly", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ git: { mode: "commit" } }),
    )
    const config = loadConfig(tmpDir)
    expect(config.git.mode).toBe("commit")
  })

  test("reads git.mode=commit_and_push_and_wait_ci", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ git: { mode: "commit_and_push_and_wait_ci" } }),
    )
    const config = loadConfig(tmpDir)
    expect(config.git.mode).toBe("commit_and_push_and_wait_ci")
  })

  test("ignores unknown top-level fields when git.mode is absent", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ unknownFlag: true }),
    )
    const config = loadConfig(tmpDir)
    expect(config.git.mode).toBe("none")
  })

  test("returns defaults for invalid git.mode value", () => {
    const configDir = path.join(tmpDir, ".ralphe")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ git: { mode: "invalid_value" } }),
    )
    // parseGitMode throws, caught by the try/catch, returns defaults
    const config = loadConfig(tmpDir)
    expect(config).toEqual({
      engine: "claude",
      maxAttempts: 2,
      checks: [],
      git: { mode: "none" },
      report: "none",
    })
  })
})

describe("saveConfig", () => {
  test("creates directory and writes config with canonical git.mode", () => {
    saveConfig(
      {
        engine: "codex",
        maxAttempts: 5,
        checks: ["cargo test"],
        git: { mode: "commit_and_push" },
        report: "none",
      },
      tmpDir,
    )
    const configPath = getConfigPath(tmpDir)
    expect(fs.existsSync(configPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(saved.engine).toBe("codex")
    expect(saved.maxAttempts).toBe(5)
    expect(saved.checks).toEqual(["cargo test"])
    expect(saved.git.mode).toBe("commit_and_push")
  })

  test("saves git.mode=commit correctly", () => {
    saveConfig(
      {
        engine: "claude",
        maxAttempts: 2,
        checks: [],
        git: { mode: "commit" },
        report: "none",
      },
      tmpDir,
    )
    const saved = JSON.parse(fs.readFileSync(getConfigPath(tmpDir), "utf-8"))
    expect(saved.git.mode).toBe("commit")
  })
})

describe("parseGitMode", () => {
  test("accepts valid modes", () => {
    expect(parseGitMode("none")).toBe("none")
    expect(parseGitMode("commit")).toBe("commit")
    expect(parseGitMode("commit_and_push")).toBe("commit_and_push")
    expect(parseGitMode("commit_and_push_and_wait_ci")).toBe("commit_and_push_and_wait_ci")
  })

  test("rejects invalid string", () => {
    expect(() => parseGitMode("invalid")).toThrow(/Invalid git.mode/)
  })

  test("rejects non-string values", () => {
    expect(() => parseGitMode(42)).toThrow(/Invalid git.mode/)
    expect(() => parseGitMode(true)).toThrow(/Invalid git.mode/)
    expect(() => parseGitMode(null)).toThrow(/Invalid git.mode/)
  })

  test("error message lists valid values", () => {
    expect(() => parseGitMode("bad")).toThrow(
      /none, commit, commit_and_push, commit_and_push_and_wait_ci/,
    )
  })
})
