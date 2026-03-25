/**
 * Seer configuration.
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

import { ConfigurationError } from "./errors.ts"

/**
 * Branch to sync the bot-owned checkout to on startup.
 *
 * Defaults to "main". Override via `SEER_TRACKED_BRANCH`.
 */
export function trackedBranch(): string {
  return process.env.SEER_TRACKED_BRANCH ?? "main"
}

/**
 * Root of the repository checkout used for file reads and indexing.
 *
 * Defaults to cwd. Override via `SEER_REPO_ROOT`.
 */
export function repoRoot(): string {
  return process.env.SEER_REPO_ROOT || process.cwd()
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

/**
 * Validate that Google Chat adapter auth is configured.
 *
 * The adapter requires one of:
 *   - `GOOGLE_CHAT_CREDENTIALS` — service account JSON string
 *   - `GOOGLE_CHAT_USE_ADC=true` — Application Default Credentials
 *
 * Throws a {@link ConfigurationError} with actionable guidance when
 * neither is set. Call before constructing the adapter so operators
 * see a clear app-level message instead of a raw SDK exception.
 */
export function validateGoogleChatAuth(): void {
  const hasCredentials = !!process.env.GOOGLE_CHAT_CREDENTIALS
  const hasAdc =
    process.env.GOOGLE_CHAT_USE_ADC?.toLowerCase() === "true"

  if (hasCredentials || hasAdc) return

  throw new ConfigurationError(
    [
      "Google Chat authentication is not configured.",
      "",
      "Seer requires one of the following environment variables to be set:",
      "",
      "  Option A — Service account credentials (workspace / CI):",
      '    GOOGLE_CHAT_CREDENTIALS=\'{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}\'',
      "",
      "  Option B — Application Default Credentials (local development):",
      "    GOOGLE_CHAT_USE_ADC=true",
      "    Then run: gcloud auth application-default login",
      "",
      "See apps/seer/README.md § \"Google Chat Setup\" and .env.example for details.",
    ].join("\n"),
  )
}
