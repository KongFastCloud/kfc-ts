/**
 * ABOUTME: Tests for deterministic epic worktree bootstrap command selection.
 * Verifies package-manager detection and command mapping.
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import {
  detectBootstrapPackageManager,
  bootstrapCommandFor,
  bootstrapEpicWorktree,
} from "../src/epicBootstrap.js"

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-bootstrap-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("detectBootstrapPackageManager", () => {
  test("detects bun from bun.lock", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, "bun.lock"), "")
    expect(detectBootstrapPackageManager(dir)).toBe("bun")
  })

  test("detects pnpm from pnpm-lock.yaml", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "")
    expect(detectBootstrapPackageManager(dir)).toBe("pnpm")
  })

  test("detects yarn from yarn.lock", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, "yarn.lock"), "")
    expect(detectBootstrapPackageManager(dir)).toBe("yarn")
  })

  test("falls back to npm when no known lockfile exists", () => {
    const dir = makeTempDir()
    expect(detectBootstrapPackageManager(dir)).toBe("npm")
  })
})

describe("bootstrapCommandFor", () => {
  test("maps package managers to strict install commands", () => {
    expect(bootstrapCommandFor("pnpm")).toEqual(["pnpm", ["install", "--frozen-lockfile"]])
    expect(bootstrapCommandFor("bun")).toEqual(["bun", ["install", "--frozen-lockfile"]])
    expect(bootstrapCommandFor("yarn")).toEqual(["yarn", ["install", "--frozen-lockfile"]])
    expect(bootstrapCommandFor("npm")).toEqual(["npm", ["ci"]])
  })
})

describe("bootstrapEpicWorktree", () => {
  test("is a no-op when package.json is missing", async () => {
    const dir = makeTempDir()
    await expect(Effect.runPromise(bootstrapEpicWorktree(dir))).resolves.toBeUndefined()
  })
})
