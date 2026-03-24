/**
 * ABOUTME: Failure summary construction for retry feedback.
 * Formats error information from blueprints run results into short
 * summaries suitable for inclusion in session activities and retry prompts.
 *
 * Error-held state is derived entirely from Linear session status — the
 * worker does not maintain a private in-memory hold queue.
 *
 * This module is intentionally pure — no Effect or Linear SDK dependencies.
 */

// ---------------------------------------------------------------------------
// Failure summary construction
// ---------------------------------------------------------------------------

/**
 * Build a short failure summary from a run error string.
 * Truncates to a reasonable length for inclusion in retry feedback.
 */
export const buildFailureSummary = (
  error: string | undefined,
  attempts: number,
): string => {
  const errorText = error ?? "Unknown error"
  const truncated =
    errorText.length > 500 ? `${errorText.slice(0, 497)}...` : errorText
  return `Failed after ${attempts} attempt(s): ${truncated}`
}
