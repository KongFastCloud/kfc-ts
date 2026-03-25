/**
 * Repochat configuration.
 *
 * Centralises environment variable reads and defaults so the rest of
 * the app can import typed config values rather than reading
 * `process.env` ad-hoc.
 *
 * Config is read via accessor functions so values reflect the
 * environment at call time. This keeps production usage simple
 * (call once at startup) while allowing tests to override env vars
 * between calls.
 */

/**
 * Branch to sync the bot-owned checkout to on startup.
 *
 * Defaults to "main". Override via `REPOCHAT_TRACKED_BRANCH`.
 */
export function trackedBranch(): string {
  return process.env.REPOCHAT_TRACKED_BRANCH ?? "main"
}

/**
 * Root of the repository checkout used for file reads and indexing.
 *
 * Defaults to cwd. Override via `REPOCHAT_REPO_ROOT`.
 */
export function repoRoot(): string {
  return process.env.REPOCHAT_REPO_ROOT || process.cwd()
}

/**
 * Path to the codemogger index database.
 *
 * Optional — codemogger defaults to `<project>/.codemogger/index.db`
 * when unset.
 */
export function codemoggerDbPath(): string | undefined {
  return process.env.CODEMOGGER_DB_PATH
}
