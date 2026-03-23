/**
 * ABOUTME: Issue loading and rehydration from Linear for ralphly.
 * Queries issues delegated to the configured agent and loads full issue
 * details including relations, children, and workflow state — the raw
 * material needed for readiness classification and prompt construction.
 */

import { Effect } from "effect"
import type { Issue, IssueRelation } from "@linear/sdk"
import { Linear } from "./client.js"
import { FatalError } from "../errors.js"
import type {
  LinearIssueData,
  LinearWorkflowState,
  LinearIssueRelation,
  LinearRelationType,
  WorkflowStateType,
} from "./types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract workflow state data from a Linear Issue. */
const resolveState = async (issue: Issue): Promise<LinearWorkflowState | null> => {
  try {
    const state = await issue.state
    if (!state) return null
    return {
      id: state.id,
      name: state.name,
      type: state.type as WorkflowStateType,
    }
  } catch {
    return null
  }
}

/** Extract child issue IDs. */
const resolveChildIds = async (issue: Issue): Promise<string[]> => {
  try {
    const children = await issue.children()
    return children.nodes.map((c) => c.id)
  } catch {
    return []
  }
}

/** Extract issue relations. */
const resolveRelations = async (
  issue: Issue,
): Promise<{ relations: LinearIssueRelation[]; inverseRelations: LinearIssueRelation[] }> => {
  const mapRelation = (r: IssueRelation, issueId: string, relatedIssueId: string): LinearIssueRelation => ({
    issueId,
    relatedIssueId,
    type: r.type as LinearRelationType,
  })

  let relations: LinearIssueRelation[] = []
  let inverseRelations: LinearIssueRelation[] = []

  try {
    const rels = await issue.relations()
    for (const r of rels.nodes) {
      const relatedIssue = await r.relatedIssue
      if (relatedIssue) {
        relations.push(mapRelation(r, issue.id, relatedIssue.id))
      }
    }
  } catch {
    // Relations may not be accessible
  }

  try {
    const invRels = await issue.inverseRelations()
    for (const r of invRels.nodes) {
      const sourceIssue = await r.issue
      if (sourceIssue) {
        inverseRelations.push(mapRelation(r, sourceIssue.id, issue.id))
      }
    }
  } catch {
    // Inverse relations may not be accessible
  }

  return { relations, inverseRelations }
}

/**
 * Convert a Linear SDK Issue to our plain data type.
 * Resolves lazy relationships eagerly so downstream code gets a complete snapshot.
 */
const toIssueData = async (issue: Issue): Promise<LinearIssueData> => {
  const [state, childIds, { relations, inverseRelations }] = await Promise.all([
    resolveState(issue),
    resolveChildIds(issue),
    resolveRelations(issue),
  ])

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    url: issue.url,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    estimate: issue.estimate ?? null,
    branchName: issue.branchName,
    state,
    parentId: issue.parentId ?? null,
    childIds,
    relations,
    inverseRelations,
    delegateId: issue.delegateId ?? null,
    assigneeId: issue.assigneeId ?? null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt ?? null,
    canceledAt: issue.canceledAt ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a single issue by ID directly from Linear.
 * Resolves state, children, and relations eagerly.
 */
export const loadIssue = (
  issueId: string,
): Effect.Effect<LinearIssueData | null, FatalError, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear
    const issue = yield* Effect.tryPromise({
      try: () => client.issue(issueId),
      catch: (err) =>
        new FatalError({
          command: "loadIssue",
          message: `Failed to load issue ${issueId}: ${err}`,
        }),
    })
    if (!issue) return null
    return yield* Effect.tryPromise({
      try: () => toIssueData(issue),
      catch: (err) =>
        new FatalError({
          command: "loadIssue",
          message: `Failed to resolve issue details for ${issueId}: ${err}`,
        }),
    })
  })

/**
 * Load all issues delegated to a specific agent user.
 * Uses the Linear issue filter's `delegate` field to query server-side.
 *
 * Only returns non-terminal issues (not completed or canceled) by default.
 */
export const loadDelegatedIssues = (opts: {
  agentId: string
  includeTerminal?: boolean
}): Effect.Effect<LinearIssueData[], FatalError, Linear> =>
  Effect.gen(function* () {
    const client = yield* Linear
    const issues: LinearIssueData[] = []

    let hasMore = true
    let cursor: string | undefined

    while (hasMore) {
      const connection = yield* Effect.tryPromise({
        try: () =>
          client.issues({
            first: 50,
            ...(cursor ? { after: cursor } : {}),
            filter: {
              delegate: { id: { eq: opts.agentId } },
              ...(opts.includeTerminal
                ? {}
                : {
                    completedAt: { null: true },
                    canceledAt: { null: true },
                  }),
            },
          }),
        catch: (err) =>
          new FatalError({
            command: "loadDelegatedIssues",
            message: `Failed to load delegated issues for agent ${opts.agentId}: ${err}`,
          }),
      })

      for (const issue of connection.nodes) {
        const data = yield* Effect.tryPromise({
          try: () => toIssueData(issue),
          catch: (err) =>
            new FatalError({
              command: "loadDelegatedIssues",
              message: `Failed to resolve issue details for ${issue.id}: ${err}`,
            }),
        })
        issues.push(data)
      }

      hasMore = connection.pageInfo.hasNextPage
      cursor = connection.pageInfo.endCursor ?? undefined
    }

    return issues
  })

/**
 * Check whether an issue is in a terminal state (completed or canceled).
 */
export const isTerminal = (issue: LinearIssueData): boolean =>
  issue.completedAt !== null ||
  issue.canceledAt !== null ||
  issue.state?.type === "completed" ||
  issue.state?.type === "canceled" ||
  issue.state?.type === "duplicate"
