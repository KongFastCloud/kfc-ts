/**
 * ABOUTME: Tests for project detection and check command discovery.
 * Owns the contract that detectProject identifies language, package manager,
 * and available check commands from filesystem markers (package.json,
 * tsconfig.json, lock files). Also verifies monorepo root-only behavior
 * and that all root package.json scripts are surfaced as selectable options.
 */

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
      { command: "npm run test", enabledByDefault: true },
      { command: "npm run lint", enabledByDefault: true },
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

  test("uses only root package scripts when nested workspace packages exist", () => {
    fs.mkdirSync(path.join(tmpDir, "apps", "web"), { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { lint: "turbo lint" } }),
    )
    fs.writeFileSync(
      path.join(tmpDir, "apps", "web", "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit" } }),
    )
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "")

    const result = detectProject(tmpDir)

    expect(result.packageManager).toBe("pnpm")
    expect(result.checks).toEqual([
      { command: "pnpm run lint", enabledByDefault: true },
    ])
  })

  test("returns empty for non-package roots", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "")
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "")
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "")
    const result = detectProject(tmpDir)
    expect(result.language).toBe("")
    expect(result.packageManager).toBe("")
    expect(result.checks).toEqual([])
  })

  test("surfaces all root package.json scripts as selectable options", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "vitest",
          build: "tsup",
          dev: "next dev",
          "db:migrate": "prisma migrate deploy",
          clean: "rm -rf dist",
        },
      }),
    )
    const result = detectProject(tmpDir)
    expect(result.checks).toHaveLength(7)
    const names = result.checks.map((c) => c.command)
    expect(names).toContain("npm run typecheck")
    expect(names).toContain("npm run lint")
    expect(names).toContain("npm run test")
    expect(names).toContain("npm run build")
    expect(names).toContain("npm run dev")
    expect(names).toContain("npm run db:migrate")
    expect(names).toContain("npm run clean")
  })

  test("default-enabled policy: only verification scripts are enabled by default", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "vitest",
          build: "tsup",
          dev: "next dev",
          format: "prettier --write .",
          "db:seed": "prisma db seed",
        },
      }),
    )
    const result = detectProject(tmpDir)

    const enabled = result.checks.filter((c) => c.enabledByDefault)
    const disabled = result.checks.filter((c) => !c.enabledByDefault)

    // Only typecheck, lint, test are enabled by default
    expect(enabled.map((c) => c.command).sort()).toEqual([
      "npm run lint",
      "npm run test",
      "npm run typecheck",
    ])

    // All others are disabled by default
    expect(disabled.map((c) => c.command).sort()).toEqual([
      "npm run build",
      "npm run db:seed",
      "npm run dev",
      "npm run format",
    ])
  })

  test("package-manager-specific command rendering for all scripts", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest", deploy: "firebase deploy" },
      }),
    )
    fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "")
    const result = detectProject(tmpDir)
    expect(result.checks).toEqual([
      { command: "yarn run test", enabledByDefault: true },
      { command: "yarn run deploy", enabledByDefault: false },
    ])
  })

  test("bun test special case applies only to test script", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: { test: "bun test", "test:e2e": "playwright test" },
      }),
    )
    fs.writeFileSync(path.join(tmpDir, "bun.lock"), "")
    const result = detectProject(tmpDir)
    expect(result.checks).toEqual([
      { command: "bun test", enabledByDefault: true },
      { command: "bun run test:e2e", enabledByDefault: false },
    ])
  })

  test("handles package.json with no scripts field", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "empty-pkg" }),
    )
    const result = detectProject(tmpDir)
    expect(result.checks).toEqual([])
    expect(result.packageManager).toBe("npm")
  })
})
