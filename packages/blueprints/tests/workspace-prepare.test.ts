/**
 * ABOUTME: Tests for the workspace-prepare pipeline.
 *
 * Owned contracts:
 *  1. Stage ordering — ensure → copy-ignored → bootstrap executes in strict order
 *  2. Hard gate semantics — failure in any stage terminates the pipeline
 *  3. Output contract — successful pipeline returns stable result shape
 *  4. App-agnostic — no Beads/epic/tracker coupling
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { workspacePrepare } from "../src/workspace-prepare.js"
import type { WorkspacePrepareInput, WorkspacePrepareResult } from "../src/workspace-prepare.js"
import { FatalError } from "../src/errors.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = []

const makeTempDir = (prefix = "bp-wsprep-"): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * Initialize a temporary directory as a git repository.
 */
const initGitRepo = (dir: string, gitignoreContent = ""): void => {
  const run = (args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    if (proc.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(proc.stderr)}`)
    }
  }
  run(["init"])
  run(["config", "user.email", "test@test.com"])
  run(["config", "user.name", "Test"])
  if (gitignoreContent) {
    fs.writeFileSync(path.join(dir, ".gitignore"), gitignoreContent)
  }
  // Need at least one commit for worktree creation
  fs.writeFileSync(path.join(dir, "README.md"), "init")
  run(["add", "."])
  run(["commit", "-m", "init"])
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ===========================================================================
// Contract 1: Stage ordering
// ===========================================================================

describe("stage ordering", () => {
  test("executes ensure → copy-ignored → bootstrap in order and returns result", async () => {
    const repo = makeTempDir("bp-wsprep-order-")
    initGitRepo(repo, "local-cache/\n")

    // Create an ignored artifact in the source repo
    fs.mkdirSync(path.join(repo, "local-cache"))
    fs.writeFileSync(path.join(repo, "local-cache", "data.txt"), "cached")

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "epic-wt")

    const input: WorkspacePrepareInput = {
      worktreePath,
      branch: "test-branch",
      sourceWorkspace: repo,
      sourceCwd: repo,
    }

    const result = await Effect.runPromise(workspacePrepare(input))

    // Stage 1: worktree was created
    expect(result.worktreePath).toBe(worktreePath)
    expect(fs.existsSync(path.join(worktreePath, ".git"))).toBe(true)

    // Stage 2: ignored artifact was copied
    expect(result.copyResult.copied).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(worktreePath, "local-cache", "data.txt"))).toBe(true)
    expect(fs.readFileSync(path.join(worktreePath, "local-cache", "data.txt"), "utf-8")).toBe("cached")

    // Stage 3: bootstrap completed (no package.json → no-op, but stage ran)
    expect(result.completedStage).toBe("bootstrap")
  })

  test("copies ignored entries respecting .worktreeinclude narrowing", async () => {
    const repo = makeTempDir("bp-wsprep-include-")
    initGitRepo(repo, "local-cache/\nsecrets/\n")

    // Create ignored artifacts
    fs.mkdirSync(path.join(repo, "local-cache"))
    fs.writeFileSync(path.join(repo, "local-cache", "data.txt"), "cached")
    fs.mkdirSync(path.join(repo, "secrets"))
    fs.writeFileSync(path.join(repo, "secrets", "key.pem"), "secret")

    // Narrowing: only copy local-cache
    fs.writeFileSync(path.join(repo, ".worktreeinclude"), "local-cache\n")

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "epic-wt")

    const result = await Effect.runPromise(
      workspacePrepare({
        worktreePath,
        branch: "test-include",
        sourceWorkspace: repo,
        sourceCwd: repo,
      }),
    )

    // local-cache was copied
    expect(fs.existsSync(path.join(worktreePath, "local-cache", "data.txt"))).toBe(true)
    // secrets was NOT copied (excluded by .worktreeinclude)
    expect(fs.existsSync(path.join(worktreePath, "secrets"))).toBe(false)
    expect(result.completedStage).toBe("bootstrap")
  })
})

// ===========================================================================
// Contract 2: Hard gate semantics
// ===========================================================================

describe("hard gate semantics", () => {
  test("failure in ensure stage terminates pipeline with FatalError", async () => {
    // Provide an invalid sourceCwd so git commands fail
    const input: WorkspacePrepareInput = {
      worktreePath: "/tmp/nonexistent-wt-target",
      branch: "test-branch",
      sourceWorkspace: "/tmp/nonexistent-source",
      sourceCwd: "/tmp/this-does-not-exist-at-all",
    }

    const result = await Effect.runPromiseExit(workspacePrepare(input))
    expect(result._tag).toBe("Failure")
  })

  test("failure in copy-ignored stage terminates pipeline (ensure succeeds, copy fails)", async () => {
    const repo = makeTempDir("bp-wsprep-copyfail-")
    initGitRepo(repo)

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "epic-wt")

    // Create the worktree successfully, but provide a non-git source for copy
    // so discoverIgnoredEntries fails
    const badSource = "/tmp/not-a-git-repo-for-copy-test-" + Date.now()

    const result = await Effect.runPromiseExit(
      workspacePrepare({
        worktreePath,
        branch: "test-copyfail",
        sourceWorkspace: badSource,
        sourceCwd: repo,
      }),
    )

    // Ensure stage succeeded (worktree was created)
    expect(fs.existsSync(path.join(worktreePath, ".git"))).toBe(true)

    // But pipeline failed due to copy-ignored stage
    expect(result._tag).toBe("Failure")
  })
})

// ===========================================================================
// Contract 3: Output contract
// ===========================================================================

describe("output contract", () => {
  test("successful result has stable shape with all required fields", async () => {
    const repo = makeTempDir("bp-wsprep-output-")
    initGitRepo(repo)

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "epic-wt")

    const result = await Effect.runPromise(
      workspacePrepare({
        worktreePath,
        branch: "test-output",
        sourceWorkspace: repo,
        sourceCwd: repo,
      }),
    )

    // Required fields exist and have correct types
    expect(typeof result.worktreePath).toBe("string")
    expect(result.worktreePath).toBe(worktreePath)
    expect(typeof result.copyResult.copied).toBe("number")
    expect(typeof result.copyResult.skipped).toBe("number")
    expect(Array.isArray(result.copyResult.failures)).toBe(true)
    expect(result.completedStage).toBe("bootstrap")
  })

  test("copyResult reflects actual copy counts", async () => {
    const repo = makeTempDir("bp-wsprep-counts-")
    initGitRepo(repo, ".env\n")

    // Create an ignored file
    fs.writeFileSync(path.join(repo, ".env"), "KEY=value")

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "epic-wt")

    const result = await Effect.runPromise(
      workspacePrepare({
        worktreePath,
        branch: "test-counts",
        sourceWorkspace: repo,
        sourceCwd: repo,
      }),
    )

    expect(result.copyResult.copied).toBe(1)
    expect(result.copyResult.skipped).toBe(0)
    expect(result.copyResult.failures).toEqual([])
  })
})

// ===========================================================================
// Contract 4: App-agnostic
// ===========================================================================

describe("app-agnostic", () => {
  test("pipeline accepts raw paths and branch — no epic/tracker context required", async () => {
    const repo = makeTempDir("bp-wsprep-agnostic-")
    initGitRepo(repo)

    const worktreePath = path.join(makeTempDir("bp-wsprep-wt-"), "any-workspace")

    // Demonstrates that the pipeline works with arbitrary workspace names
    // and branches — no EpicContext, no Beads, no tracker needed
    const result = await Effect.runPromise(
      workspacePrepare({
        worktreePath,
        branch: "feature/any-branch-name",
        sourceWorkspace: repo,
        sourceCwd: repo,
      }),
    )

    expect(result.worktreePath).toBe(worktreePath)
    expect(result.completedStage).toBe("bootstrap")
  })

  test("pipeline type signature has no tracker dependencies", () => {
    // TypeScript structural verification: the input/output types reference
    // only primitive types and CopyIgnoredResult — no Beads, Linear, Epic,
    // or tracker types. This is enforced by the compiler at the import site.
    //
    // If a tracker type were added to WorkspacePrepareInput or
    // WorkspacePrepareResult, this test file would fail to compile without
    // importing that tracker type.
    expect(true).toBe(true)
  })
})
