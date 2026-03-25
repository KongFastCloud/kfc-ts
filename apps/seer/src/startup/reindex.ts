/**
 * Best-effort codemogger reindex.
 *
 * Runs `npx codemogger index <dir>` to rebuild the search index.
 * This is startup-only work — failures are logged and swallowed so
 * the server can still start (with a potentially stale or empty index).
 */

import { Effect } from "effect"
import { execFile } from "node:child_process"

/**
 * Run the codemogger index command for the given directory.
 *
 * Uses `npx -y codemogger index <dir>` with an optional `--db` flag
 * when a custom database path is configured.
 *
 * Timeout is generous (5 minutes) because large repos may take a while
 * on first index.
 */
function runCodemoggerIndex(
  repoRoot: string,
  dbPath: string | undefined,
): Promise<string> {
  const args = ["-y", "codemogger", "index", repoRoot]
  if (dbPath) {
    args.push("--db", dbPath)
  }

  return new Promise((resolve, reject) => {
    execFile("npx", args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`codemogger index failed: ${stderr.trim() || err.message}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

/**
 * Trigger a codemogger reindex for the repository.
 */
export const reindex = (
  repoRoot: string,
  dbPath: string | undefined,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting codemogger reindex").pipe(
      Effect.annotateLogs("repoRoot", repoRoot),
      Effect.annotateLogs("dbPath", dbPath ?? "<default>"),
    )

    const output = yield* Effect.tryPromise({
      try: () => runCodemoggerIndex(repoRoot, dbPath),
      catch: (cause) =>
        new Error(`reindex failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    })

    if (output) {
      yield* Effect.logInfo("Codemogger reindex output").pipe(
        Effect.annotateLogs("output", output),
      )
    }

    yield* Effect.logInfo("Codemogger reindex completed")
  })
