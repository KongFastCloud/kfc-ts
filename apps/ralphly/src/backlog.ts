/**
 * ABOUTME: Backlog selection logic for ralphly's work loop.
 * Uses readiness classification to deterministically pick the next
 * actionable issue from the candidate work pool, skipping blocked,
 * error-held, and terminal issues.
 */

import type { CandidateWork } from "./linear/types.js"
import {
  classifyAll,
  buildClassificationContext,
  type ClassifiedWork,
  type ClassificationContext,
} from "./readiness.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of backlog selection: what to work on and what was skipped. */
export interface BacklogSelection {
  /** The next actionable item to process, or null if nothing is ready. */
  readonly next: CandidateWork | null
  /** All classified work items, for logging/debugging. */
  readonly classified: readonly ClassifiedWork[]
  /** Summary counts by readiness. */
  readonly summary: BacklogSummary
}

/** Counts by readiness classification. */
export interface BacklogSummary {
  readonly actionable: number
  readonly blocked: number
  readonly errorHeld: number
  readonly terminal: number
  readonly total: number
}

// ---------------------------------------------------------------------------
// Selection logic
// ---------------------------------------------------------------------------

/**
 * Select the next actionable work item from a pool of candidates.
 *
 * Selection priority among actionable items:
 * 1. Higher Linear priority (lower number = higher priority)
 * 2. Older creation date (FIFO within same priority)
 *
 * Non-actionable items are skipped but still included in the result
 * for observability.
 */
export const selectNext = (
  candidates: readonly CandidateWork[],
  ctx?: ClassificationContext,
): BacklogSelection => {
  const context = ctx ?? buildClassificationContext(candidates)
  const classified = classifyAll(candidates, context)

  const actionable = classified.filter((c) => c.readiness === "actionable")

  // Sort actionable items: highest priority first (lowest number),
  // then oldest first (earliest createdAt)
  actionable.sort((a, b) => {
    const priDiff = a.work.issue.priority - b.work.issue.priority
    if (priDiff !== 0) return priDiff
    return a.work.issue.createdAt.getTime() - b.work.issue.createdAt.getTime()
  })

  const summary = summarize(classified)

  return {
    next: actionable[0]?.work ?? null,
    classified,
    summary,
  }
}

/**
 * Select all actionable work items from a pool of candidates,
 * in processing order (priority then FIFO).
 *
 * Use this when the caller wants to drain the entire backlog rather
 * than process one item at a time.
 */
export const selectAllActionable = (
  candidates: readonly CandidateWork[],
  ctx?: ClassificationContext,
): BacklogSelection => {
  const context = ctx ?? buildClassificationContext(candidates)
  const classified = classifyAll(candidates, context)

  const actionable = classified.filter((c) => c.readiness === "actionable")

  actionable.sort((a, b) => {
    const priDiff = a.work.issue.priority - b.work.issue.priority
    if (priDiff !== 0) return priDiff
    return a.work.issue.createdAt.getTime() - b.work.issue.createdAt.getTime()
  })

  const summary = summarize(classified)

  return {
    next: actionable[0]?.work ?? null,
    classified,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a summary from classified work. */
const summarize = (classified: readonly ClassifiedWork[]): BacklogSummary => ({
  actionable: classified.filter((c) => c.readiness === "actionable").length,
  blocked: classified.filter((c) => c.readiness === "blocked").length,
  errorHeld: classified.filter((c) => c.readiness === "error-held").length,
  terminal: classified.filter((c) => c.readiness === "terminal").length,
  total: classified.length,
})

/**
 * Format a human-readable summary of the backlog selection.
 * Useful for logging.
 */
export const formatBacklogSummary = (selection: BacklogSelection): string => {
  const { summary, next, classified } = selection
  const lines: string[] = [
    `Backlog: ${summary.total} total, ${summary.actionable} actionable, ${summary.blocked} blocked, ${summary.errorHeld} error-held, ${summary.terminal} terminal`,
  ]

  if (next) {
    lines.push(`Next: ${next.issue.identifier} — ${next.issue.title}`)
  } else {
    lines.push("Next: (none — no actionable work)")
  }

  // Log non-actionable items for visibility
  for (const c of classified) {
    if (c.readiness !== "actionable") {
      lines.push(`  skip ${c.work.issue.identifier}: ${c.readiness} — ${c.reason}`)
    }
  }

  return lines.join("\n")
}
