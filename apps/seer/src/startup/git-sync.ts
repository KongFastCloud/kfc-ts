/**
 * Best-effort git sync for the bot-owned checkout.
 *
 * Attempts to align the local checkout to the configured tracked
 * branch by fetching and resetting. This is startup-only work —
 * failures are logged and swallowed so the server can still start.
 *
 * Assumptions:
 *   - The checkout at REPO_ROOT is a valid git repository.
 *   - The bot process has read/write access to the working tree.
 *   - Network failures (fetch) are transient and acceptable at startup.
 */

import { Effect } from "effect"
import { execFile } from "node:child_process"

/**
 * Run a git command in the given directory.
 *
 * Returns stdout on success, rejects with stderr on failure.
 */
function git(
  repoRoot: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoRoot, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args[0]} failed: ${stderr.trim() || err.message}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

/**
 * Sync the local checkout to the tracked branch.
 *
 * Strategy:
 *   1. `git fetch origin <branch>` — get latest refs
 *   2. `git checkout <branch>`     — switch to the branch
 *   3. `git reset --hard origin/<branch>` — align to remote
 *
 * The reset is intentional: the bot-owned checkout is not a
 * development workspace. Local changes are discarded in favour
 * of the remote truth.
 */
export const syncTrackedBranch = (
  repoRoot: string,
  branch: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting git sync").pipe(
      Effect.annotateLogs("branch", branch),
      Effect.annotateLogs("repoRoot", repoRoot),
    )

    // Fetch the tracked branch from origin
    yield* Effect.tryPromise({
      try: () => git(repoRoot, ["fetch", "origin", branch]),
      catch: (cause) =>
        new Error(`fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    })

    // Checkout the branch (may already be on it)
    yield* Effect.tryPromise({
      try: () => git(repoRoot, ["checkout", branch]),
      catch: (cause) =>
        new Error(`checkout failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    })

    // Hard-reset to origin to discard any local drift
    yield* Effect.tryPromise({
      try: () => git(repoRoot, ["reset", "--hard", `origin/${branch}`]),
      catch: (cause) =>
        new Error(`reset failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    })

    yield* Effect.logInfo("Git sync completed")
  })
