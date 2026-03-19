import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { gitCommit, gitCommitAndPush, gitPush } from "../src/git.js"
import { Engine } from "../src/engine/Engine.js"

const mockEngine = (response: string) =>
  Layer.succeed(Engine, {
    execute: () => Effect.succeed({ response }),
  })

let tmpDir: string
let originalCwd: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-git-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)

  Bun.spawnSync(["git", "init"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: tmpDir })
})

afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true })
})

describe("gitCommitAndPush", () => {
  test("commits with agent-generated message", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello")

    await Effect.runPromise(
      gitCommitAndPush().pipe(
        Effect.provide(mockEngine("feat: add hello file")),
        // push will fail (no remote) — catch it
        Effect.catchTag("FatalError", (err) =>
          err.command.startsWith("git push")
            ? Effect.succeed(undefined)
            : Effect.fail(err),
        ),
      ),
    )

    const log = Bun.spawnSync(["git", "log", "--oneline"], { cwd: tmpDir })
    const output = new TextDecoder().decode(log.stdout)
    expect(output).toContain("feat: add hello file")
  })

  test("does nothing when there are no changes", async () => {
    fs.writeFileSync(path.join(tmpDir, "init.txt"), "init")
    Bun.spawnSync(["git", "add", "-A"], { cwd: tmpDir })
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: tmpDir })

    await Effect.runPromise(
      gitCommitAndPush().pipe(Effect.provide(mockEngine("should not be called"))),
    )

    const log = Bun.spawnSync(["git", "log", "--oneline"], { cwd: tmpDir })
    const output = new TextDecoder().decode(log.stdout)
    expect(output).not.toContain("should not be called")
  })
})

describe("gitCommit", () => {
  test("returns commit hash when commit occurs", async () => {
    fs.writeFileSync(path.join(tmpDir, "commit-only.txt"), "hello")

    const commitResult = await Effect.runPromise(
      gitCommit().pipe(Effect.provide(mockEngine("feat: commit only test"))),
    )

    expect(commitResult).toBeDefined()
    expect(commitResult?.hash).toMatch(/^[a-f0-9]{7,}$/)
  })

  test("returns undefined when there are no changes", async () => {
    fs.writeFileSync(path.join(tmpDir, "init.txt"), "init")
    Bun.spawnSync(["git", "add", "-A"], { cwd: tmpDir })
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: tmpDir })

    const commitResult = await Effect.runPromise(
      gitCommit().pipe(Effect.provide(mockEngine("should-not-run"))),
    )

    expect(commitResult).toBeUndefined()
  })
})

describe("gitPush", () => {
  test("returns pushed remote/ref when remote is configured", async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-git-remote-"))
    try {
      Bun.spawnSync(["git", "init", "--bare", remoteDir], { cwd: tmpDir })

      // Seed remote tracking with an initial commit.
      fs.writeFileSync(path.join(tmpDir, "seed.txt"), "seed")
      Bun.spawnSync(["git", "add", "-A"], { cwd: tmpDir })
      Bun.spawnSync(["git", "commit", "-m", "seed"], { cwd: tmpDir })
      Bun.spawnSync(["git", "remote", "add", "origin", remoteDir], { cwd: tmpDir })

      const branch = new TextDecoder().decode(
        Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: tmpDir }).stdout,
      ).trim()
      Bun.spawnSync(["git", "push", "-u", "origin", branch], { cwd: tmpDir })

      // Create a new local commit to push.
      fs.writeFileSync(path.join(tmpDir, "delta.txt"), "delta")
      await Effect.runPromise(
        gitCommit().pipe(Effect.provide(mockEngine("feat: push test commit"))),
      )

      const pushResult = await Effect.runPromise(gitPush())
      expect(pushResult.remote).toBe("origin")
      expect(pushResult.ref).toBe(branch)
    } finally {
      fs.rmSync(remoteDir, { recursive: true })
    }
  })
})
