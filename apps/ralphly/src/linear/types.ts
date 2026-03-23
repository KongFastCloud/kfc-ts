/**
 * ABOUTME: Domain types for Linear session and issue data loaded by ralphly.
 * These are ralphly's own representations — intentionally decoupled from the
 * Linear SDK's lazy-loaded model classes so that downstream code (readiness
 * classification, prompt building) works with plain serialisable data.
 */

// ---------------------------------------------------------------------------
// Issue state
// ---------------------------------------------------------------------------

/**
 * Workflow state category as reported by Linear.
 * Maps to WorkflowState.type in the SDK.
 */
export type WorkflowStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate"

/** Snapshot of a Linear workflow state. */
export interface LinearWorkflowState {
  readonly id: string
  readonly name: string
  readonly type: WorkflowStateType
}

// ---------------------------------------------------------------------------
// Issue relations
// ---------------------------------------------------------------------------

/** Relation type between two issues. */
export type LinearRelationType = "blocks" | "duplicate" | "related" | "similar"

/** A directional relationship between two issues. */
export interface LinearIssueRelation {
  /** The issue that owns this relation (the "from" side). */
  readonly issueId: string
  /** The related issue (the "to" side). */
  readonly relatedIssueId: string
  /** How issueId relates to relatedIssueId. */
  readonly type: LinearRelationType
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

/** Snapshot of a Linear issue with the fields ralphly needs. */
export interface LinearIssueData {
  readonly id: string
  /** Human-readable identifier, e.g. "ENG-123". */
  readonly identifier: string
  readonly title: string
  readonly description: string | null
  readonly url: string
  readonly priority: number
  readonly priorityLabel: string
  readonly estimate: number | null
  readonly branchName: string

  /** Workflow state snapshot. */
  readonly state: LinearWorkflowState | null

  /** Parent issue ID, if any. */
  readonly parentId: string | null
  /** IDs of child issues. */
  readonly childIds: readonly string[]

  /** Direct relations originating from this issue. */
  readonly relations: readonly LinearIssueRelation[]
  /** Inverse relations (other issues pointing at this one). */
  readonly inverseRelations: readonly LinearIssueRelation[]

  /** The agent user this issue is delegated to, if any. */
  readonly delegateId: string | null
  /** The human assignee, if any. */
  readonly assigneeId: string | null

  readonly createdAt: Date
  readonly updatedAt: Date
  readonly completedAt: Date | null
  readonly canceledAt: Date | null
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Status of an agent session in Linear. */
export type AgentSessionStatusValue =
  | "active"
  | "awaitingInput"
  | "complete"
  | "error"
  | "pending"
  | "stale"

/** Snapshot of a Linear agent session. */
export interface LinearSessionData {
  readonly id: string
  readonly status: AgentSessionStatusValue

  /** The agent user this session belongs to. */
  readonly appUserId: string | null
  /** The issue this session is associated with. */
  readonly issueId: string | null
  /** The human who initiated the session. */
  readonly creatorId: string | null

  readonly createdAt: Date
  readonly updatedAt: Date
  readonly startedAt: Date | null
  readonly endedAt: Date | null

  /** Summary of activities so far. */
  readonly summary: string | null
}

// ---------------------------------------------------------------------------
// Prompt content from session activities
// ---------------------------------------------------------------------------

/** A single prompt message from a session's activity history. */
export interface SessionPrompt {
  /** The activity ID. */
  readonly id: string
  /** The type of activity (e.g. "prompt", "response", "thought"). */
  readonly type: string
  /** Raw content payload from the activity. */
  readonly content: Record<string, unknown>
  readonly createdAt: Date
}

// ---------------------------------------------------------------------------
// Loaded work: session + issue combined
// ---------------------------------------------------------------------------

/** A candidate work item: a session paired with its issue data. */
export interface CandidateWork {
  readonly session: LinearSessionData
  readonly issue: LinearIssueData
}
