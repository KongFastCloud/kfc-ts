/**
 * Startup orchestration.
 *
 * Runs best-effort sync and reindex before the server begins serving
 * traffic. Both steps are attempted in sequence (reindex depends on
 * sync for freshness) but each failure is isolated — a sync failure
 * still allows reindex to run against the existing checkout, and a
 * reindex failure still allows the server to start.
 *
 * This module exports a plain async function (not an Effect Layer)
 * because the startup work is fire-and-log, not a long-lived service
 * dependency. The server does not depend on its success.
 */

import { Effect, Logger } from "effect"
import { syncTrackedBranch } from "./git-sync.ts"
import { reindex } from "./reindex.ts"
import { trackedBranch, repoRoot, codemoggerDbPath } from "../config.ts"

/**
 * Run best-effort startup tasks: git sync then codemogger reindex.
 *
 * - Sync failure is logged; reindex still runs against existing checkout.
 * - Reindex failure is logged; server still starts.
 * - Both steps share the same logger configuration.
 */
export async function runStartupTasks(): Promise<void> {
  const logLayer = Logger.replace(
    Logger.defaultLogger,
    Logger.withLeveledConsole(Logger.logfmtLogger),
  )

  const root = repoRoot()
  const branch = trackedBranch()
  const dbPath = codemoggerDbPath()

  // ── Git sync (best-effort) ──
  const syncProgram = syncTrackedBranch(root, branch).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Startup git sync failed — continuing with existing checkout").pipe(
        Effect.annotateLogs("error", cause instanceof Error ? cause.message : String(cause)),
      ),
    ),
    Effect.catchAll(() => Effect.void),
  )

  await Effect.runPromise(syncProgram.pipe(Effect.provide(logLayer)))

  // ── Codemogger reindex (best-effort) ──
  const reindexProgram = reindex(root, dbPath).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Startup codemogger reindex failed — index may be stale or empty").pipe(
        Effect.annotateLogs("error", cause instanceof Error ? cause.message : String(cause)),
      ),
    ),
    Effect.catchAll(() => Effect.void),
  )

  await Effect.runPromise(reindexProgram.pipe(Effect.provide(logLayer)))
}
