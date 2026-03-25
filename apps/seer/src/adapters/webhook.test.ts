/**
 * Tests for the Git provider webhook adapter.
 *
 * Verifies:
 *   - GitHub push events for the tracked branch trigger reindex.
 *   - GitHub push events for non-tracked branches are ignored.
 *   - Non-push GitHub events are ignored.
 *   - GitLab push events are recognised.
 *   - Generic ref payloads are recognised.
 *   - Invalid JSON is handled gracefully.
 *   - Webhook always returns 200 (fast response).
 */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Effect, Fiber, Logger } from "effect"

import { handleBranchUpdateWebhook } from "./webhook.ts"
import { reindexWorkerLoop, _resetForTest } from "../reindex-worker.ts"

const logLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)

describe("handleBranchUpdateWebhook", () => {
  let workerFiber: Fiber.RuntimeFiber<void>

  beforeEach(async () => {
    _resetForTest()

    // Start the worker so requestReindex has somewhere to send signals
    workerFiber = Effect.runFork(
      reindexWorkerLoop.pipe(Effect.provide(logLayer)),
    )
    await new Promise((r) => setTimeout(r, 50))
  })

  // afterEach equivalent — clean up in each test's finally block
  async function cleanup() {
    await Effect.runPromise(Fiber.interrupt(workerFiber))
    _resetForTest()
  }

  it("GitHub push to tracked branch returns reindex_requested", async () => {
    const origBranch = process.env.SEER_TRACKED_BRANCH
    process.env.SEER_TRACKED_BRANCH = "main"

    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ ref: "refs/heads/main" }),
        { "x-github-event": "push" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "reindex_requested")
    } finally {
      if (origBranch === undefined) delete process.env.SEER_TRACKED_BRANCH
      else process.env.SEER_TRACKED_BRANCH = origBranch
      await cleanup()
    }
  })

  it("GitHub push to non-tracked branch is ignored", async () => {
    const origBranch = process.env.SEER_TRACKED_BRANCH
    process.env.SEER_TRACKED_BRANCH = "main"

    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ ref: "refs/heads/feature/xyz" }),
        { "x-github-event": "push" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
      assert.equal(result.body.reason, "branch_mismatch")
    } finally {
      if (origBranch === undefined) delete process.env.SEER_TRACKED_BRANCH
      else process.env.SEER_TRACKED_BRANCH = origBranch
      await cleanup()
    }
  })

  it("GitHub non-push event is ignored", async () => {
    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ action: "opened" }),
        { "x-github-event": "pull_request" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
    } finally {
      await cleanup()
    }
  })

  it("GitLab Push Hook for tracked branch returns reindex_requested", async () => {
    const origBranch = process.env.SEER_TRACKED_BRANCH
    process.env.SEER_TRACKED_BRANCH = "main"

    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ ref: "refs/heads/main" }),
        { "x-gitlab-event": "Push Hook" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "reindex_requested")
    } finally {
      if (origBranch === undefined) delete process.env.SEER_TRACKED_BRANCH
      else process.env.SEER_TRACKED_BRANCH = origBranch
      await cleanup()
    }
  })

  it("GitLab non-push event is ignored", async () => {
    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ ref: "refs/heads/main" }),
        { "x-gitlab-event": "Merge Request Hook" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
    } finally {
      await cleanup()
    }
  })

  it("generic ref payload for tracked branch returns reindex_requested", async () => {
    const origBranch = process.env.SEER_TRACKED_BRANCH
    process.env.SEER_TRACKED_BRANCH = "develop"

    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ ref: "refs/heads/develop" }),
        {},
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "reindex_requested")
    } finally {
      if (origBranch === undefined) delete process.env.SEER_TRACKED_BRANCH
      else process.env.SEER_TRACKED_BRANCH = origBranch
      await cleanup()
    }
  })

  it("invalid JSON body returns 200 with ignored action", async () => {
    try {
      const result = await handleBranchUpdateWebhook(
        "not valid json{{{",
        { "x-github-event": "push" },
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
    } finally {
      await cleanup()
    }
  })

  it("empty body returns 200 with ignored action", async () => {
    try {
      const result = await handleBranchUpdateWebhook("", {})

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
    } finally {
      await cleanup()
    }
  })

  it("payload without ref field is ignored", async () => {
    try {
      const result = await handleBranchUpdateWebhook(
        JSON.stringify({ commits: [] }),
        {},
      )

      assert.equal(result.status, 200)
      assert.equal(result.body.action, "ignored")
    } finally {
      await cleanup()
    }
  })
})
