/**
 * ABOUTME: In-memory error-hold tracking for issue-level failure state.
 * When blueprints exhausts retries for an issue, the worker records the
 * failure here instead of stopping globally. The store persists within
 * a single worker run and enables same-session retry when a prompted
 * follow-up clears the hold.
 *
 * This module is intentionally pure — no Effect or Linear SDK dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Record of an error-held issue with its failure context. */
export interface ErrorHoldRecord {
  /** The Linear issue ID. */
  readonly issueId: string
  /** The session ID where the failure occurred. */
  readonly sessionId: string
  /** Short failure summary for retry feedback. */
  readonly failureSummary: string
  /** When the hold was recorded. */
  readonly failedAt: Date
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * In-memory store for error-held issues during a worker run.
 *
 * Keyed by issue ID — each issue can have at most one active hold.
 * Clearing a hold removes the record and returns the failure summary
 * so the caller can pass it as retry feedback.
 */
export class ErrorHoldStore {
  private readonly holds = new Map<string, ErrorHoldRecord>()

  /** Record an error hold for an issue. Overwrites any existing hold. */
  record(record: ErrorHoldRecord): void {
    this.holds.set(record.issueId, record)
  }

  /**
   * Clear an error hold and return the record for retry feedback.
   * Returns null if the issue is not error-held.
   */
  clear(issueId: string): ErrorHoldRecord | null {
    const record = this.holds.get(issueId)
    if (!record) return null
    this.holds.delete(issueId)
    return record
  }

  /** Check if an issue is error-held. */
  has(issueId: string): boolean {
    return this.holds.has(issueId)
  }

  /** Get the hold record for an issue, if any. */
  get(issueId: string): ErrorHoldRecord | null {
    return this.holds.get(issueId) ?? null
  }

  /** Get all error-held issue IDs. */
  heldIds(): ReadonlySet<string> {
    return new Set(this.holds.keys())
  }

  /** Number of issues currently error-held. */
  get size(): number {
    return this.holds.size
  }
}

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
