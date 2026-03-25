/**
 * Tests for the startup orchestration.
 *
 * Verifies that runStartupTasks completes without throwing even when
 * sync and reindex both fail (best-effort contract).
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("runStartupTasks", () => {
  it("completes without throwing even when sync and reindex fail", async () => {
    // Set env vars that will cause both steps to fail
    const origBranch = process.env.SEER_TRACKED_BRANCH
    const origRoot = process.env.SEER_REPO_ROOT

    process.env.SEER_TRACKED_BRANCH = "nonexistent-branch-xyz"
    process.env.SEER_REPO_ROOT = "/tmp/nonexistent-repo-startup-test"

    try {
      // Dynamic import to pick up the env vars we just set
      // We need to clear the config module cache first
      const { runStartupTasks } = await import("./index.ts")
      await assert.doesNotReject(() => runStartupTasks())
    } finally {
      if (origBranch === undefined) delete process.env.SEER_TRACKED_BRANCH
      else process.env.SEER_TRACKED_BRANCH = origBranch

      if (origRoot === undefined) delete process.env.SEER_REPO_ROOT
      else process.env.SEER_REPO_ROOT = origRoot
    }
  })
})
