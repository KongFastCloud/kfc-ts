/**
 * ABOUTME: Epic domain model for the two-level epic/task execution hierarchy.
 * Defines the EpicContext type, validation rules, and loading logic.
 *
 * An epic is a non-runnable Beads issue whose canonical Beads type is
 * `epic` and whose body holds the full PRD. For backward compatibility,
 * the legacy `epic` label is still accepted as an alternate marker.
 * Runnable tasks must belong to exactly one epic through the Beads parent
 * relationship. The executor loads the parent epic context before running
 * any child task.
 *
 * This module is the authoritative source for epic validation rules.
 * Invalid or incomplete epic context produces explicit errors rather than
 * silent fallbacks.
 */

import { Effect } from "effect"
import { FatalError } from "./errors.js"
import type { WatchTask } from "./beadsAdapter.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Validated epic execution context loaded from a parent Beads issue.
 * Produced by {@link validateEpicContext} after all invariants are checked.
 */
export interface EpicContext {
  /** Epic issue ID. */
  readonly id: string
  /** Epic title. */
  readonly title: string
  /** Full PRD body from the epic issue description. */
  readonly body: string
  /** Labels on the epic issue (must include "epic"). */
  readonly labels: readonly string[]
  /** Canonical branch name owned by this epic. */
  readonly branch: string
}

// ---------------------------------------------------------------------------
// Error reasons (exported for test assertions)
// ---------------------------------------------------------------------------

export const EPIC_ERROR_NO_PARENT =
  "Task has no parent epic. Standalone tasks are not valid execution inputs in the epic model."

export const EPIC_ERROR_PARENT_NOT_FOUND = (parentId: string) =>
  `Parent issue "${parentId}" could not be loaded. Epic context is required for task execution.`

export const EPIC_ERROR_NOT_EPIC = (parentId: string) =>
  `Parent issue "${parentId}" is not an epic issue. Only issues with Beads type "epic" (or the legacy "epic" label) can serve as task parents.`

export const EPIC_ERROR_EMPTY_BODY = (parentId: string) =>
  `Epic "${parentId}" has no PRD body (empty description). A non-empty PRD is required for task execution.`

export const EPIC_ERROR_MISSING_BRANCH = (parentId: string) =>
  `Epic "${parentId}" has no canonical branch in its metadata. A branch must be set before tasks can execute.`

/**
 * Predicate: does the given error reason string represent an invalid-context
 * failure? This is used by the operational layer to distinguish epic-context
 * validation failures from execution-time failures.
 *
 * An invalid-context failure means the task never started executing because
 * its parent epic was missing, incomplete, or invalid.
 */
export const isInvalidEpicContextError = (reason: string): boolean =>
  reason === EPIC_ERROR_NO_PARENT ||
  reason.includes("could not be loaded") ||
  reason.includes("is not an epic issue") ||
  reason.includes("has no PRD body") ||
  reason.includes("has no canonical branch")

/**
 * Predicate: is this issue an epic in the Beads model?
 * Canonical signal is issueType === "epic"; the legacy `epic` label is still
 * accepted so existing data and tests continue to work during migration.
 */
export const isEpicIssue = (issue: WatchTask): boolean =>
  issue.issueType === "epic" || issue.labels?.includes("epic") === true

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a loaded WatchTask as a valid epic and extract the EpicContext.
 *
 * Validation rules:
 * 1. Must be an epic issue (Beads type `epic`, or legacy `epic` label)
 * 2. Must have a non-empty description (PRD body)
 * 3. Must have a non-empty canonical branch name
 *
 * Returns an EpicContext on success or a descriptive error string on failure.
 */
export const validateEpicContext = (
  epicIssue: WatchTask,
): { readonly _tag: "Ok"; readonly context: EpicContext } | { readonly _tag: "Err"; readonly reason: string } => {
  const labels = epicIssue.labels ?? []

  if (!isEpicIssue(epicIssue)) {
    return { _tag: "Err", reason: EPIC_ERROR_NOT_EPIC(epicIssue.id) }
  }

  const body = epicIssue.description?.trim()
  if (!body) {
    return { _tag: "Err", reason: EPIC_ERROR_EMPTY_BODY(epicIssue.id) }
  }

  const branch = epicIssue.branch?.trim()
  if (!branch) {
    return { _tag: "Err", reason: EPIC_ERROR_MISSING_BRANCH(epicIssue.id) }
  }

  return {
    _tag: "Ok",
    context: {
      id: epicIssue.id,
      title: epicIssue.title,
      body,
      labels,
      branch,
    },
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Dependency: a function that loads a single issue by ID.
 * Matches the signature of {@link import("./beadsAdapter.js").queryTaskDetail}.
 */
export type QueryTaskDetail = (
  id: string,
  cwd?: string,
) => Effect.Effect<WatchTask | undefined, FatalError>

/**
 * Load and validate the epic context for a task.
 *
 * Returns an EpicContext when the parent epic is valid, or fails the effect
 * with a descriptive reason string when:
 * - The task has no parentId (standalone)
 * - The parent issue cannot be loaded
 * - The parent issue fails epic validation
 *
 * The caller is responsible for translating the failure reason into the
 * appropriate Beads error state (e.g. markTaskExhaustedFailure).
 */
export const loadEpicContext = (
  parentId: string | undefined,
  queryTaskDetail: QueryTaskDetail,
  cwd?: string,
): Effect.Effect<EpicContext, string> =>
  Effect.gen(function* () {
    if (!parentId) {
      return yield* Effect.fail(EPIC_ERROR_NO_PARENT)
    }

    const epicIssue = yield* queryTaskDetail(parentId, cwd).pipe(
      Effect.mapError(() => EPIC_ERROR_PARENT_NOT_FOUND(parentId)),
    )

    if (!epicIssue) {
      return yield* Effect.fail(EPIC_ERROR_PARENT_NOT_FOUND(parentId))
    }

    const result = validateEpicContext(epicIssue)
    if (result._tag === "Err") {
      return yield* Effect.fail(result.reason)
    }

    return result.context
  })

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the epic PRD preamble to prepend to a child task prompt.
 * Includes the epic title and full PRD body so the agent has complete
 * context about the parent effort.
 */
export const buildEpicPreamble = (epic: EpicContext): string =>
  `## Epic: ${epic.title}\n\n${epic.body}\n\n---\n`
