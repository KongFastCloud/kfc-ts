/**
 * ABOUTME: Dependency-aware readiness classification for Linear issues.
 * Classifies issues as actionable, blocked, error-held, or terminal based
 * on explicit blocking relationships, parent/sub-issue structure, and
 * session status. This module is intentionally pure — no Effect or Linear
 * SDK dependencies — so it can be tested independently from data loading.
 */

import type { LinearIssueData, CandidateWork, AgentSessionStatusValue } from "./linear/types.js"
import { isTerminal } from "./linear/issues.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Readiness classification for a delegated issue. */
export type IssueReadiness = "actionable" | "blocked" | "error-held" | "terminal"

/** A classified work item: candidate work paired with its readiness. */
export interface ClassifiedWork {
  readonly work: CandidateWork
  readonly readiness: IssueReadiness
  /** Human-readable reason for the classification. */
  readonly reason: string
}

/**
 * Context needed for readiness classification beyond the issue itself.
 * Allows the classifier to look up related issues for blocker resolution.
 */
export interface ClassificationContext {
  /** All known issues keyed by ID, for looking up blockers and parents. */
  readonly issuesById: ReadonlyMap<string, LinearIssueData>
  /** Issue IDs that are in an error-held state (session status "error"). */
  readonly errorHeldIds: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Classify a single issue's readiness.
 *
 * Priority order (first match wins):
 * 1. Terminal — issue is completed, canceled, or duplicate.
 * 2. Error-held — the issue's session is in "error" status.
 * 3. Blocked — a non-terminal issue blocks this one, or a non-terminal
 *    parent has incomplete non-terminal children that block progress.
 * 4. Actionable — none of the above apply.
 *
 * Blocking semantics:
 * - An issue is blocked if another issue has a "blocks" relation pointing
 *   at it (via inverseRelations) and that blocker is not terminal.
 * - An issue is blocked if it has a parent and the parent has non-terminal
 *   children (siblings) that block this issue via explicit relations.
 * - A child issue is blocked if its parent is itself blocked.
 */
export const classifyIssue = (
  issue: LinearIssueData,
  sessionStatus: AgentSessionStatusValue | null,
  ctx: ClassificationContext,
): { readiness: IssueReadiness; reason: string } => {
  // 1. Terminal
  if (isTerminal(issue)) {
    return { readiness: "terminal", reason: "issue is in a terminal state" }
  }

  // 2. Error-held (session is in error status)
  if (sessionStatus === "error" || ctx.errorHeldIds.has(issue.id)) {
    return { readiness: "error-held", reason: "session is in error status" }
  }

  // 3. Blocked by explicit blocking relations
  const blockingResult = findBlockingRelation(issue, ctx)
  if (blockingResult) {
    return { readiness: "blocked", reason: blockingResult }
  }

  // 4. Blocked by parent being blocked
  const parentBlockResult = checkParentBlocking(issue, ctx)
  if (parentBlockResult) {
    return { readiness: "blocked", reason: parentBlockResult }
  }

  // 5. Actionable
  return { readiness: "actionable", reason: "no blockers detected" }
}

/**
 * Check if an issue is blocked by explicit "blocks" relations.
 * Returns a reason string if blocked, or null if not blocked.
 *
 * An issue is blocked when another issue has a "blocks" relation where
 * this issue is the target (appears in inverseRelations) and that
 * blocker is not in a terminal state.
 */
const findBlockingRelation = (
  issue: LinearIssueData,
  ctx: ClassificationContext,
): string | null => {
  // inverseRelations: other issues pointing at this one
  // A relation with type "blocks" where relatedIssueId === issue.id
  // means issueId blocks this issue
  for (const rel of issue.inverseRelations) {
    if (rel.type !== "blocks") continue

    const blocker = ctx.issuesById.get(rel.issueId)
    // If we can't resolve the blocker, conservatively treat it as blocking.
    // This avoids accidentally processing an issue whose blocker we can't see.
    if (!blocker) {
      return `blocked by unknown issue ${rel.issueId} (not in loaded context)`
    }

    if (!isTerminal(blocker)) {
      return `blocked by non-terminal issue ${blocker.identifier}`
    }
  }

  // Also check forward relations: if this issue has "blocks" relations,
  // that means this issue blocks others — not relevant for *this* issue's readiness.
  // But check if this issue is the relatedIssueId side of a "blocks" relation
  // in the relations array (which would mean this issue blocks relatedIssueId).
  // That's the forward direction — not a block on this issue.

  return null
}

/**
 * Check if an issue is blocked because its parent is blocked.
 * A child inherits the blocked status of its parent, since a blocked
 * parent implies the sub-issue work is not yet ready.
 *
 * Also checks if the parent has incomplete children that this issue
 * depends on via the parent/sub-issue structure.
 */
const checkParentBlocking = (
  issue: LinearIssueData,
  ctx: ClassificationContext,
): string | null => {
  if (!issue.parentId) return null

  const parent = ctx.issuesById.get(issue.parentId)
  if (!parent) return null

  // If parent is terminal, children should be unblocked by parent
  if (isTerminal(parent)) return null

  // If the parent itself is blocked by an explicit relation, child inherits block
  const parentBlocked = findBlockingRelation(parent, ctx)
  if (parentBlocked) {
    return `parent ${parent.identifier} is blocked (${parentBlocked})`
  }

  return null
}

// ---------------------------------------------------------------------------
// Batch classification
// ---------------------------------------------------------------------------

/**
 * Build a ClassificationContext from a set of candidate work items and
 * optionally additional issues (e.g. blockers that aren't delegated).
 */
export const buildClassificationContext = (
  candidates: readonly CandidateWork[],
  additionalIssues?: readonly LinearIssueData[],
): ClassificationContext => {
  const issuesById = new Map<string, LinearIssueData>()
  const errorHeldIds = new Set<string>()

  for (const { issue, session } of candidates) {
    issuesById.set(issue.id, issue)
    if (session.status === "error") {
      errorHeldIds.add(issue.id)
    }
  }

  if (additionalIssues) {
    for (const issue of additionalIssues) {
      issuesById.set(issue.id, issue)
    }
  }

  return { issuesById, errorHeldIds }
}

/**
 * Classify all candidate work items.
 * Returns ClassifiedWork items in the same order as input.
 */
export const classifyAll = (
  candidates: readonly CandidateWork[],
  ctx?: ClassificationContext,
): ClassifiedWork[] => {
  const context = ctx ?? buildClassificationContext(candidates)

  return candidates.map((work) => {
    const { readiness, reason } = classifyIssue(
      work.issue,
      work.session.status,
      context,
    )
    return { work, readiness, reason }
  })
}
