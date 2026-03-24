/**
 * ABOUTME: Tests for git operations workspace propagation.
 * Verifies that git commands execute in the explicit workspace directory,
 * not in the ambient process.cwd().
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Engine } from "../src/engine.js"
import { gitCommit, gitPush, isWorktreeDirty } from "../src/git.js"

const makeGitRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-git-"))
  const workspace = fs.realpathSync(dir)

  // Initialize a git repo with an initial commit
  Bun.spawnSync(["git", "init"], { cwd: workspace })
  Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: workspace })
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: workspace })
  fs.writeFileSync(path.join(workspace, "README.md"), "# Test\n")
  Bun.spawnSync(["git", "add", "-A"], { cwd: workspace })
  Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: workspace })

  return workspace
}

let workspace: string

afterEach(() => {
  if (workspace) {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

describe("isWorktreeDirty", () => {
  test("returns false for clean workspace", async () => {
    workspace = makeGitRepo()

    const result = await Effect.runPromise(isWorktreeDirty(workspace))
    expect(result).toBe(false)
  })

  test("returns true when workspace has uncommitted changes", async () => {
    workspace = makeGitRepo()
    fs.writeFileSync(path.join(workspace, "new-file.txt"), "hello\n")

    const result = await Effect.runPromise(isWorktreeDirty(workspace))
    expect(result).toBe(true)
  })

  test("operates on provided workspace, not cwd", async () => {
    workspace = makeGitRepo()

    // Create a dirty file in the test workspace
    fs.writeFileSync(path.join(workspace, "dirty.txt"), "dirty\n")

    // Even though our cwd is different, isWorktreeDirty should check the workspace
    const result = await Effect.runPromise(isWorktreeDirty(workspace))
    expect(result).toBe(true)
  })
})

describe("gitCommit", () => {
  test("returns undefined when workspace has no changes", async () => {
    workspace = makeGitRepo()

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "feat: no-op" }),
    })

    const result = await Effect.runPromise(
      Effect.provide(gitCommit(workspace), layer),
    )
    expect(result).toBeUndefined()
  })

  test("commits changes in the provided workspace", async () => {
    workspace = makeGitRepo()
    fs.writeFileSync(path.join(workspace, "feature.ts"), "export const x = 1\n")

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "feat: add feature" }),
    })

    const result = await Effect.runPromise(
      Effect.provide(gitCommit(workspace), layer),
    )

    expect(result).toBeDefined()
    expect(result!.message).toBe("feat: add feature")
    expect(result!.hash).toBeTruthy()

    // Verify the commit is in the workspace repo
    const log = Bun.spawnSync(["git", "log", "--oneline", "-1"], { cwd: workspace })
    const logOutput = new TextDecoder().decode(log.stdout)
    expect(logOutput).toContain("feat: add feature")
  })

  test("stages and commits in workspace even when cwd differs", async () => {
    workspace = makeGitRepo()
    fs.writeFileSync(path.join(workspace, "file.ts"), "content\n")

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "chore: add file" }),
    })

    const result = await Effect.runPromise(
      Effect.provide(gitCommit(workspace), layer),
    )

    expect(result).toBeDefined()
    expect(result!.message).toBe("chore: add file")

    // Verify workspace is clean after commit
    const dirty = await Effect.runPromise(isWorktreeDirty(workspace))
    expect(dirty).toBe(false)
  })
})
