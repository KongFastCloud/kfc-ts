/**
 * Background reindex worker.
 *
 * Provides an Effect-native in-process worker that performs git sync
 * followed by codemogger reindex when signalled. The worker uses a
 * simple coalescing strategy: if a reindex is already running, at most
 * one follow-up run is queued. Additional signals while a run is
 * in-flight are collapsed into that single pending re-run.
 *
 * Design:
 *   - Single long-lived fiber, started once at boot.
 *   - A Deferred acts as the wake signal (one-shot, then replaced).
 *   - A Ref<boolean> tracks whether another run is pending.
 *   - Chat stays available because the worker runs on its own fiber.
 *   - Logs are the primary operational surface.
 */

import { Effect, Deferred, Ref, Logger } from "effect"
import { syncTrackedBranch } from "./startup/git-sync.ts"
import { reindex } from "./startup/reindex.ts"
import { trackedBranch, repoRoot, codemoggerDbPath } from "./config.ts"

// ── Module-level state ──

/** Deferred used to wake the worker. Replaced after each wake. */
let signal: Deferred.Deferred<void> | null = null

/** Whether another run has been requested while one is in-flight. */
let pendingRef: Ref.Ref<boolean> | null = null

/** Whether the worker has been initialised. */
let initialised = false

// ── Public API ──

/**
 * Request a background sync + reindex.
 *
 * Returns immediately. If a run is already in-flight, the request is
 * coalesced into at most one follow-up run.
 *
 * Safe to call before the worker is started — the signal will be
 * picked up when the worker loop begins.
 */
export const requestReindex = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!initialised || !signal || !pendingRef) {
      yield* Effect.logWarning("Reindex requested but worker not yet initialised — ignoring")
      return
    }

    // If the deferred is already done (worker is running), mark pending
    const signalDone = yield* Deferred.isDone(signal)
    if (signalDone) {
      yield* Ref.set(pendingRef, true)
      yield* Effect.logInfo("Reindex already running — coalesced into pending follow-up")
    } else {
      // Wake the worker
      yield* Deferred.succeed(signal, void 0)
      yield* Effect.logInfo("Reindex signal sent to worker")
    }
  })

/**
 * The long-running worker loop.
 *
 * Waits for a signal, runs sync + reindex, then checks if another
 * run was requested while it was busy. If so, runs once more.
 * Repeats forever.
 *
 * This should be forked as a daemon fiber at boot.
 */
export const reindexWorkerLoop: Effect.Effect<void> =
  Effect.gen(function* () {
    // Initialise state on first entry
    signal = yield* Deferred.make<void>()
    pendingRef = yield* Ref.make(false)
    initialised = true

    yield* Effect.logInfo("Reindex worker started — waiting for signals")

    // Infinite loop: wait → run → maybe re-run → reset
    yield* Effect.forever(
      Effect.gen(function* () {
        // Wait for wake signal
        yield* Deferred.await(signal!)

        // Run sync + reindex (best-effort, same as startup)
        yield* runSyncAndReindex()

        // Check if another run was requested while we were busy
        const needsFollowUp = yield* Ref.getAndSet(pendingRef!, false)
        if (needsFollowUp) {
          yield* Effect.logInfo("Pending reindex follow-up — running again")
          yield* runSyncAndReindex()
          // Drain any further pending flag from during the follow-up
          yield* Ref.set(pendingRef!, false)
        }

        // Replace the signal deferred for the next wake cycle
        signal = yield* Deferred.make<void>()
      }),
    )
  })

// ── Internal helpers ──

/**
 * Best-effort sync + reindex, matching startup behaviour.
 * Failures are logged but do not crash the worker.
 */
const runSyncAndReindex = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    const root = repoRoot()
    const branch = trackedBranch()
    const dbPath = codemoggerDbPath()

    yield* Effect.logInfo("Background sync + reindex starting").pipe(
      Effect.annotateLogs("branch", branch),
      Effect.annotateLogs("repoRoot", root),
    )

    // ── Git sync ──
    yield* syncTrackedBranch(root, branch).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Background git sync failed — reindexing existing checkout").pipe(
          Effect.annotateLogs("error", cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
      Effect.catchAll(() => Effect.void),
    )

    // ── Codemogger reindex ──
    yield* reindex(root, dbPath).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Background codemogger reindex failed").pipe(
          Effect.annotateLogs("error", cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
      Effect.catchAll(() => Effect.void),
    )

    yield* Effect.logInfo("Background sync + reindex completed")
  })

// ── Test helpers ──

/**
 * Reset module state. For tests only.
 */
export const _resetForTest = (): void => {
  signal = null
  pendingRef = null
  initialised = false
}

/**
 * Check whether the worker has been initialised. For tests only.
 */
export const _isInitialised = (): boolean => initialised
