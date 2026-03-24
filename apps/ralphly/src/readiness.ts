/**
 * ABOUTME: Dependency-aware readiness classification for Linear issues.
 * Classifies issues as actionable, blocked, error-held, ineligible, or
 * terminal based on Linear workflow categories, explicit blocking
 * relationships, parent/sub-issue structure, and session status.
 *
 * Readiness is derived from Linear as the source of truth:
 * - Only issues in Todo (unstarted) or In Progress (started) workflow
 *   categories are candidates for work. Backlog, Triage, and unknown
 *   categories are ineligible regardless of delegation status.
 * - Terminal, error-held, and blocked checks further gate actionability.
 * - Error-held state is dual-sourced: session status "error" OR an
 *   unresolved error activity in the session history (activity-derived).
 *   The activity-based path is the durable mechanism that survives across
 *   fresh CLI invocations.
 *
 * Session semantics (interaction boundary):
 * - Delegation creates a session ("created" event).
 * - Follow-up in the session UI creates a "prompted" event on the same
 *   session, continuing the interaction.
 * - Plain comments and out-of-session mentions are not supported triggers.
 * - Re-delegation while an active session exists reuses that session;
 *   a new session is created only when no active session remains.
 *
 * This module is intentionally pure — no Effect or Linear SDK
 * dependencies — so it can be tested independently from data loading.
 */

import type { LinearIssueData, CandidateWork, AgentSessionStatusValue, WorkflowStateType } from "./linear/types.js"
import { isTerminal } from "./linear/issues.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Readiness classification for a delegated issue. */
export type IssueReadiness = "actionable" | "blocked" | "error-held" | "ineligible" | "terminal"

/**
 * Workflow state types that represent "ready" work — issues the worker
 * should consider as candidates before blocking/error checks.
 *
 * - "unstarted" = Linear's Todo column (ready to begin)
 * - "started"   = Linear's In Progress column (already underway)
 *
 * All other categories (backlog, triage, completed, canceled, duplicate)
 * are excluded from readiness.
 */
const READY_WORKFLOW_CATEGORIES: ReadonlySet<WorkflowStateType> = new Set([
  "unstarted",
  "started",
])

/**
 * Check whether a workflow state type represents a ready-for-work category.
 * Returns false for null/undefined state types (conservative: not ready).
 */
export const isReadyWorkflowCategory = (
  stateType: WorkflowStateType | null | undefined,
): boolean => stateType != null && READY_WORKFLOW_CATEGORIES.has(stateType)

/** A classified work item: candidate work paired with its readiness. */
export interface ClassifiedWork {
  readonly work: CandidateWork
  readonly readiness: IssueReadiness
  /** Human-readable reason for the classification. */
  readonly reason: string
}

/**
 * Context needed for readiness classification beyond the issue itself.
 * Allows the classifier to look up related issues for blocker resolution
 * and identify error-held issues from durable Linear-backed state.
 *
 * Error-held state is dual-sourced:
 * - Session status "error" (when Linear sets it)
 * - Activity-derived: the `errorHeldIds` set, built by loading session
 *   activities and checking for an unresolved error activity (no follow-up
 *   after the last error). This is the durable mechanism that survives
 *   across fresh CLI invocations.
 *
 * Both sources are derived from Linear — no private in-memory hold store.
 */
export interface ClassificationContext {
  /** All known issues keyed by ID, for looking up blockers and parents. */
  readonly issuesById: ReadonlyMap<string, LinearIssueData>
  /**
   * Issue IDs known to be error-held from session activity analysis.
   * Built by scanning session activities for unresolved error markers.
   * This is the durable hold mechanism — it survives process restarts
   * because the activities are persisted in Linear.
   *
   * When empty or omitted, classification falls back to session status alone.
   */
  readonly errorHeldIds?: ReadonlySet<string> | undefined
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Classify a single issue's readiness.
 *
 * Priority order (first match wins):
 * 1. Terminal — issue is completed, canceled, or duplicate.
 * 2. Ineligible — issue is not in a ready workflow category (Todo/In Progress).
 *    Backlog and Triage issues are ineligible even when delegated.
 * 3. Error-held — the issue's session is in "error" status.
 * 4. Blocked — a non-terminal issue blocks this one, or a non-terminal
 *    parent has incomplete non-terminal children that block progress.
 * 5. Actionable — none of the above apply.
 *
 * Workflow category semantics:
 * - "unstarted" (Todo) and "started" (In Progress) are the only categories
 *   considered ready for work.
 * - "backlog" and "triage" are explicitly excluded — they represent work
 *   that has not yet been promoted to the ready queue.
 * - Issues with null/unknown state are conservatively treated as ineligible.
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

  // 2. Ineligible — workflow category is not Todo/In Progress
  if (!isReadyWorkflowCategory(issue.state?.type)) {
    const stateDesc = issue.state
      ? `${issue.state.name} (${issue.state.type})`
      : "unknown (no state)"
    return {
      readiness: "ineligible",
      reason: `workflow category not ready: ${stateDesc}`,
    }
  }

  // 3. Error-held — derived from Linear-backed state (dual-sourced)
  //    a) Session status "error" (when Linear sets it)
  //    b) Activity-derived: errorHeldIds set (built from session activities)
  //    Both sources are durable across process lifetimes.
  if (sessionStatus === "error") {
    return { readiness: "error-held", reason: "session is in error status" }
  }
  if (ctx.errorHeldIds?.has(issue.id)) {
    return { readiness: "error-held", reason: "session has unresolved error activity" }
  }

  // 4. Blocked by explicit blocking relations
  const blockingResult = findBlockingRelation(issue, ctx)
  if (blockingResult) {
    return { readiness: "blocked", reason: blockingResult }
  }

  // 5. Blocked by parent being blocked
  const parentBlockResult = checkParentBlocking(issue, ctx)
  if (parentBlockResult) {
    return { readiness: "blocked", reason: parentBlockResult }
  }

  // 6. Actionable
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
 * Build a ClassificationContext from a set of candidate work items,
 * optionally additional issues (e.g. blockers that aren't delegated),
 * and optionally a set of error-held issue IDs derived from session activities.
 *
 * Error-held state is dual-sourced:
 * - Session status "error" (checked in classifyIssue())
 * - Activity-derived errorHeldIds (passed in here, built from Linear activities)
 *
 * Both sources keep queue truth in Linear — no private in-memory hold store.
 */
export const buildClassificationContext = (
  candidates: readonly CandidateWork[],
  additionalIssues?: readonly LinearIssueData[],
  errorHeldIds?: ReadonlySet<string>,
): ClassificationContext => {
  const issuesById = new Map<string, LinearIssueData>()

  for (const { issue } of candidates) {
    issuesById.set(issue.id, issue)
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
