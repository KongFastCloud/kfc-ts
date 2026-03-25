/**
 * Tests for startup git sync.
 *
 * Uses a real temporary git repository to verify the sync behaviour
 * end-to-end. No mocking of git — we create a bare remote and a
 * local clone, then verify sync aligns the local to the remote.
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { Effect, Logger } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { syncTrackedBranch } from "./git-sync.ts"

const logLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)

function run(effect: Effect.Effect<void, Error>) {
  return Effect.runPromise(effect.pipe(Effect.provide(logLayer)))
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

describe("syncTrackedBranch", () => {
  let remoteDir: string
  let localDir: string

  before(() => {
    // Create a bare "remote" repo
    remoteDir = mkdtempSync(join(tmpdir(), "repochat-test-remote-"))
    git(remoteDir, ["init", "--bare"])

    // Clone it to a "local" checkout
    localDir = mkdtempSync(join(tmpdir(), "repochat-test-local-"))
    rmSync(localDir, { recursive: true })
    execFileSync("git", ["clone", remoteDir, localDir], { encoding: "utf-8" })

    // Create an initial commit on main in the local, push to remote
    git(localDir, ["checkout", "-b", "main"])
    writeFileSync(join(localDir, "file.txt"), "initial")
    git(localDir, ["add", "."])
    git(localDir, ["-c", "user.name=test", "-c", "user.email=test@test.com", "commit", "-m", "init"])
    git(localDir, ["push", "origin", "main"])
  })

  after(() => {
    rmSync(remoteDir, { recursive: true, force: true })
    rmSync(localDir, { recursive: true, force: true })
  })

  it("syncs local checkout to the remote tracked branch", async () => {
    // Push a new commit to the remote (via a temp clone)
    const tempClone = mkdtempSync(join(tmpdir(), "repochat-test-temp-"))
    try {
      rmSync(tempClone, { recursive: true })
      execFileSync("git", ["clone", remoteDir, tempClone], { encoding: "utf-8" })
      git(tempClone, ["checkout", "main"])
      writeFileSync(join(tempClone, "file.txt"), "updated")
      git(tempClone, ["add", "."])
      git(tempClone, ["-c", "user.name=test", "-c", "user.email=test@test.com", "commit", "-m", "update"])
      git(tempClone, ["push", "origin", "main"])
    } finally {
      rmSync(tempClone, { recursive: true, force: true })
    }

    // Local is now behind. Sync should bring it up to date.
    await run(syncTrackedBranch(localDir, "main"))

    const content = execFileSync("cat", [join(localDir, "file.txt")], { encoding: "utf-8" }).trim()
    assert.equal(content, "updated")
  })

  it("fails gracefully for a non-existent branch", async () => {
    await assert.rejects(
      () => run(syncTrackedBranch(localDir, "nonexistent-branch")),
      (err: Error) => {
        assert.ok(err.message.includes("fetch failed") || err.message.includes("nonexistent-branch"))
        return true
      },
    )
  })

  it("fails gracefully for a non-existent directory", async () => {
    await assert.rejects(
      () => run(syncTrackedBranch("/tmp/nonexistent-repo-dir-xyz", "main")),
    )
  })
})
