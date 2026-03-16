import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { gitCommitAndPush } from "../src/git.js"
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
