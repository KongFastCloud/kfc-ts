import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { detectProject } from "../src/detect.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-detect-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true })
})

describe("detectProject", () => {
  test("returns empty for unknown project", () => {
    const result = detectProject(tmpDir)
    expect(result.language).toBe("")
    expect(result.checks).toEqual([])
  })

  test("detects Node.js with npm", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "jest", lint: "eslint ." } }),
    )
    const result = detectProject(tmpDir)
    expect(result.language).toBe("JavaScript")
    expect(result.packageManager).toBe("npm")
    expect(result.checks).toEqual([
      { command: "npm run lint", enabledByDefault: true },
      { command: "npm run test", enabledByDefault: true },
    ])
  })

  test("detects TypeScript with bun", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc", test: "bun test", build: "bun build" } }),
    )
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}")
    fs.writeFileSync(path.join(tmpDir, "bun.lock"), "")
    const result = detectProject(tmpDir)
    expect(result.language).toBe("TypeScript")
    expect(result.packageManager).toBe("bun")
    expect(result.checks).toEqual([
      { command: "bun run typecheck", enabledByDefault: true },
      { command: "bun test", enabledByDefault: true },
      { command: "bun run build", enabledByDefault: false },
    ])
  })

  test("detects pnpm", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    )
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "")
    const result = detectProject(tmpDir)
    expect(result.packageManager).toBe("pnpm")
    expect(result.checks[0]!.command).toBe("pnpm run test")
  })

  test("detects Python", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "")
    const result = detectProject(tmpDir)
    expect(result.language).toBe("Python")
    expect(result.checks.length).toBe(3)
  })

  test("detects Go", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "")
    const result = detectProject(tmpDir)
    expect(result.language).toBe("Go")
  })

  test("detects Rust", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "")
    const result = detectProject(tmpDir)
    expect(result.language).toBe("Rust")
  })
})
