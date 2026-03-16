import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { loadConfig, saveConfig, getConfigPath } from "../src/config.js"

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
    expect(config).toEqual({ engine: "claude", maxAttempts: 2, checks: [] })
  })
})

describe("saveConfig", () => {
  test("creates directory and writes config", () => {
    saveConfig({ engine: "codex", maxAttempts: 5, checks: ["cargo test"] }, tmpDir)
    const configPath = getConfigPath(tmpDir)
    expect(fs.existsSync(configPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(saved.engine).toBe("codex")
    expect(saved.maxAttempts).toBe(5)
    expect(saved.checks).toEqual(["cargo test"])
  })
})
