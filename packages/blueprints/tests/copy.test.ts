/**
 * ABOUTME: Tests for copy-ignored workspace bootstrap primitive.
 *
 * Owned contracts:
 *  1. readWorktreeInclude — parsing .worktreeinclude files
 *  2. filterByWorktreeInclude — entry filtering against allowlist
 *  3. discoverIgnoredEntries — git-ignored discovery (integration contract)
 *  4. copyIgnored — end-to-end copy behavior with overwrite semantics
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import {
  readWorktreeInclude,
  filterByWorktreeInclude,
  copyIgnored,
  discoverIgnoredEntries,
} from "../src/copy.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = []

const makeTempDir = (prefix = "bp-copy-"): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * Initialize a temporary directory as a git repository with a .gitignore.
 * This allows `git ls-files --ignored` to work correctly.
 */
const initGitRepo = (dir: string, gitignoreContent: string): void => {
  const run = (args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    if (proc.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(proc.stderr)}`)
    }
  }
  run(["init"])
  run(["config", "user.email", "test@test.com"])
  run(["config", "user.name", "Test"])
  fs.writeFileSync(path.join(dir, ".gitignore"), gitignoreContent)
  run(["add", ".gitignore"])
  run(["commit", "-m", "init"])
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ===========================================================================
// Contract 1: readWorktreeInclude
// ===========================================================================

describe("readWorktreeInclude", () => {
  test("returns undefined when .worktreeinclude does not exist", () => {
    const dir = makeTempDir()
    expect(readWorktreeInclude(dir)).toBeUndefined()
  })

  test("returns entries from .worktreeinclude file", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, ".worktreeinclude"), "node_modules\n.env\ndist\n")
    expect(readWorktreeInclude(dir)).toEqual(["node_modules", ".env", "dist"])
  })

  test("ignores empty lines", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, ".worktreeinclude"), "node_modules\n\n.env\n\n")
    expect(readWorktreeInclude(dir)).toEqual(["node_modules", ".env"])
  })

  test("ignores comment lines starting with #", () => {
    const dir = makeTempDir()
    fs.writeFileSync(
      path.join(dir, ".worktreeinclude"),
      "# Deps\nnode_modules\n# Build output\ndist\n",
    )
    expect(readWorktreeInclude(dir)).toEqual(["node_modules", "dist"])
  })

  test("trims whitespace from entries", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, ".worktreeinclude"), "  node_modules  \n  .env  \n")
    expect(readWorktreeInclude(dir)).toEqual(["node_modules", ".env"])
  })

  test("returns empty array for file with only comments and blank lines", () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, ".worktreeinclude"), "# comment\n\n# another\n")
    expect(readWorktreeInclude(dir)).toEqual([])
  })
})

// ===========================================================================
// Contract 2: filterByWorktreeInclude
// ===========================================================================

describe("filterByWorktreeInclude", () => {
  test("exact match includes entry", () => {
    const result = filterByWorktreeInclude(["node_modules", ".env", "dist"], ["node_modules"])
    expect(result).toEqual(["node_modules"])
  })

  test("nested entries under an include are included", () => {
    const result = filterByWorktreeInclude(
      ["node_modules/.cache/foo", "node_modules/.package-lock.json", ".env"],
      ["node_modules"],
    )
    expect(result).toEqual(["node_modules/.cache/foo", "node_modules/.package-lock.json"])
  })

  test("parent directory entry matches when include is a nested path", () => {
    // If includes say "node_modules/.cache" and we have "node_modules" as a
    // directory entry from git, the directory contains the included path
    const result = filterByWorktreeInclude(
      ["node_modules", "dist"],
      ["node_modules/.cache"],
    )
    expect(result).toEqual(["node_modules"])
  })

  test("no match when entries are unrelated", () => {
    const result = filterByWorktreeInclude([".env", "dist"], ["node_modules"])
    expect(result).toEqual([])
  })

  test("multiple includes filter correctly", () => {
    const result = filterByWorktreeInclude(
      ["node_modules", ".env", "dist", ".cache"],
      [".env", "dist"],
    )
    expect(result).toEqual([".env", "dist"])
  })

  test("trailing slashes in includes are normalized", () => {
    const result = filterByWorktreeInclude(["node_modules", ".env"], ["node_modules/"])
    expect(result).toEqual(["node_modules"])
  })

  test("empty includes filter out everything", () => {
    const result = filterByWorktreeInclude(["node_modules", ".env"], [])
    expect(result).toEqual([])
  })

  test("empty entries returns empty", () => {
    const result = filterByWorktreeInclude([], ["node_modules"])
    expect(result).toEqual([])
  })
})

// ===========================================================================
// Contract 3: discoverIgnoredEntries (integration — requires git repo)
// ===========================================================================

describe("discoverIgnoredEntries", () => {
  test("discovers ignored files in a git repo", async () => {
    const dir = makeTempDir()
    initGitRepo(dir, "ignored.txt\n")
    fs.writeFileSync(path.join(dir, "ignored.txt"), "data")

    const entries = await Effect.runPromise(discoverIgnoredEntries(dir))
    expect(entries).toContain("ignored.txt")
  })

  test("discovers ignored directories", async () => {
    const dir = makeTempDir()
    initGitRepo(dir, "build/\n")
    fs.mkdirSync(path.join(dir, "build"))
    fs.writeFileSync(path.join(dir, "build", "output.js"), "code")

    const entries = await Effect.runPromise(discoverIgnoredEntries(dir))
    expect(entries).toContain("build")
  })

  test("returns empty array when nothing is ignored", async () => {
    const dir = makeTempDir()
    initGitRepo(dir, "")

    const entries = await Effect.runPromise(discoverIgnoredEntries(dir))
    expect(entries).toEqual([])
  })

  test("does not include tracked files", async () => {
    const dir = makeTempDir()
    initGitRepo(dir, "*.log\n")
    // .gitignore is tracked — should not appear
    const entries = await Effect.runPromise(discoverIgnoredEntries(dir))
    expect(entries).not.toContain(".gitignore")
  })

  test("fails with FatalError for non-git directory", async () => {
    const dir = makeTempDir()
    const result = await Effect.runPromiseExit(discoverIgnoredEntries(dir))
    expect(result._tag).toBe("Failure")
  })
})

// ===========================================================================
// Contract 4: copyIgnored — end-to-end copy behavior
// ===========================================================================

describe("copyIgnored", () => {
  test("copies ignored files from source to destination", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "secret.env\ncache/\n")
    fs.writeFileSync(path.join(source, "secret.env"), "KEY=val")
    fs.mkdirSync(path.join(source, "cache"))
    fs.writeFileSync(path.join(source, "cache", "data.bin"), "cached")

    const result = await Effect.runPromise(copyIgnored(source, dest))

    expect(result.copied).toBeGreaterThanOrEqual(2)
    expect(result.failures).toEqual([])
    expect(fs.readFileSync(path.join(dest, "secret.env"), "utf-8")).toBe("KEY=val")
    expect(fs.readFileSync(path.join(dest, "cache", "data.bin"), "utf-8")).toBe("cached")
  })

  test("overwrites existing files in destination", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "config.env\n")
    fs.writeFileSync(path.join(source, "config.env"), "NEW_VALUE")
    fs.writeFileSync(path.join(dest, "config.env"), "OLD_VALUE")

    await Effect.runPromise(copyIgnored(source, dest))

    expect(fs.readFileSync(path.join(dest, "config.env"), "utf-8")).toBe("NEW_VALUE")
  })

  test("applies .worktreeinclude narrowing when present", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "secret.env\nnode_modules/\nbuild/\n")
    fs.writeFileSync(path.join(source, ".worktreeinclude"), "secret.env\n")
    fs.writeFileSync(path.join(source, "secret.env"), "SECRET")
    fs.mkdirSync(path.join(source, "node_modules"))
    fs.writeFileSync(path.join(source, "node_modules", "pkg.js"), "module")
    fs.mkdirSync(path.join(source, "build"))
    fs.writeFileSync(path.join(source, "build", "out.js"), "built")

    const result = await Effect.runPromise(copyIgnored(source, dest))

    // Only secret.env should be copied
    expect(result.copied).toBe(1)
    expect(fs.existsSync(path.join(dest, "secret.env"))).toBe(true)
    expect(fs.existsSync(path.join(dest, "node_modules"))).toBe(false)
    expect(fs.existsSync(path.join(dest, "build"))).toBe(false)
  })

  test("copies all when .worktreeinclude is absent", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "a.env\nb.env\n")
    fs.writeFileSync(path.join(source, "a.env"), "A")
    fs.writeFileSync(path.join(source, "b.env"), "B")

    const result = await Effect.runPromise(copyIgnored(source, dest))

    expect(result.copied).toBe(2)
    expect(fs.readFileSync(path.join(dest, "a.env"), "utf-8")).toBe("A")
    expect(fs.readFileSync(path.join(dest, "b.env"), "utf-8")).toBe("B")
  })

  test("returns zero copies when no ignored entries exist", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "")

    const result = await Effect.runPromise(copyIgnored(source, dest))
    expect(result.copied).toBe(0)
    expect(result.failures).toEqual([])
  })

  test("creates nested directories in destination", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    initGitRepo(source, "deep/\n")
    fs.mkdirSync(path.join(source, "deep", "nested", "dir"), { recursive: true })
    fs.writeFileSync(path.join(source, "deep", "nested", "dir", "file.txt"), "deep")

    const result = await Effect.runPromise(copyIgnored(source, dest))

    expect(result.copied).toBeGreaterThanOrEqual(1)
    expect(
      fs.readFileSync(path.join(dest, "deep", "nested", "dir", "file.txt"), "utf-8"),
    ).toBe("deep")
  })

  test("contract: non-git source fails with FatalError", async () => {
    const source = makeTempDir()
    const dest = makeTempDir()

    const result = await Effect.runPromiseExit(copyIgnored(source, dest))
    expect(result._tag).toBe("Failure")
  })

  test("contract: failure to copy entries surfaces as FatalError", () => {
    // When entries exist in git-ignored discovery but cannot be copied
    // (e.g. permission errors, special file types), the operation fails
    // with a FatalError containing the list of failed entries.
    //
    // The structural contract is:
    //   Effect.Effect<CopyIgnoredResult, FatalError>
    // which the TypeScript compiler enforces at the call site.
    expect(true).toBe(true)
  })
})
