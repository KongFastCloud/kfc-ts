/**
 * Tests for startup codemogger reindex.
 *
 * These are lightweight tests that verify the Effect wrapper behaviour.
 * Full codemogger indexing is tested via codemogger itself; here we
 * just verify our wrapper handles success and failure correctly.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Effect, Logger } from "effect"
import { reindex } from "./reindex.ts"

const logLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)

function run(effect: Effect.Effect<void, Error>) {
  return Effect.runPromise(effect.pipe(Effect.provide(logLayer)))
}

describe("reindex", () => {
  it("completes successfully for an empty directory (indexes 0 files)", async () => {
    // codemogger index gracefully handles empty/nonexistent dirs
    // by indexing 0 files without erroring
    await assert.doesNotReject(
      () => run(reindex("/tmp/nonexistent-repo-dir-xyz-reindex", undefined)),
    )
  })

  it("accepts an optional dbPath parameter", async () => {
    await assert.doesNotReject(
      () => run(reindex("/tmp/nonexistent-repo-dir-xyz-reindex", "/tmp/custom.db")),
    )
  })
})
