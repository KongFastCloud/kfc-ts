/**
 * ABOUTME: Watch-mode RunObserver that owns in-flight Beads lifecycle writes.
 * Encapsulates metadata writes and activity log comments so the watch path
 * can express lifecycle reactions through the RunObserver abstraction rather
 * than duplicated orchestration code.
 *
 * The observer handles "during execution" side effects (start metadata,
 * session/check comments, final metadata). Post-execution status transitions
 * (close, mark exhausted) remain in processClaimedTask because they need
 * to propagate FatalError and the RunObserver interface is error-free.
 *
 * Also exports the watch-specific request factory (buildWatchRequest)
 * that assembles a pure-data RunRequest from Beads issue context.
 */

import { Effect } from "effect"
import type { RunObserver } from "./RunObserver.js"
import type { RunRequest } from "./RunRequest.js"
import type { BeadsIssue, BeadsMetadata } from "./beads.js"
import type { RalpheConfig } from "./config.js"
import type { FatalError } from "./errors.js"
import {
  writeMetadata as defaultWriteMetadata,
  addComment as defaultAddComment,
  buildPromptFromIssue as defaultBuildPromptFromIssue,
} from "./beads.js"
import {
  formatSessionComment,
  formatCheckFailedComment,
  formatSuccessComment,
} from "./runTask.js"

// ---------------------------------------------------------------------------
// Dependency injection for testability
// ---------------------------------------------------------------------------

/**
 * Injectable Beads operations used by the observer.
 * Production code uses the real implementations; tests can override.
 */
export interface BeadsObserverDeps {
  readonly writeMetadata: (id: string, metadata: BeadsMetadata) => Effect.Effect<void, FatalError>
  readonly addComment: (id: string, text: string) => Effect.Effect<void, never>
}

// ---------------------------------------------------------------------------
// Observer factory
// ---------------------------------------------------------------------------

/**
 * Mutable state captured per observer instance. Exposed for test access
 * to verify timing metadata written by the observer.
 */
export interface BeadsObserverState {
  startedAt: string | undefined
  engine: "claude" | "codex"
}

/**
 * Create a RunObserver that writes Beads lifecycle events for a single
 * watch-mode task execution.
 *
 * Lifecycle event mapping:
 * - onStart       -> write start metadata (engine, workerId, startedAt)
 * - onAgentResult -> write session comment (resume command)
 * - onLoopEvent   -> write check_failed / success comments
 * - onComplete    -> write final metadata (timing + resume token)
 *
 * Post-execution status transitions (closeTaskSuccess, markTaskExhaustedFailure)
 * are NOT owned by the observer — they remain in processClaimedTask because
 * they need to propagate FatalError, and RunObserver methods are error-free.
 *
 * Metadata writes are fail-open: a failed write logs a warning instead of
 * propagating, consistent with the RunObserver<void, never> contract.
 */
export const makeBeadsRunObserver = (
  opts: {
    readonly issueId: string
    readonly workerId: string
  },
  depsOverride?: Partial<BeadsObserverDeps>,
  stateOut?: BeadsObserverState,
): RunObserver => {
  const deps: BeadsObserverDeps = {
    writeMetadata: defaultWriteMetadata,
    addComment: defaultAddComment,
    ...depsOverride,
  }

  // Mutable state captured per-run — safe because each observer instance
  // is created for a single processClaimedTask invocation.
  const state: BeadsObserverState = stateOut ?? { startedAt: undefined, engine: "claude" }

  return {
    onStart: (request) => {
      state.startedAt = new Date().toISOString()
      state.engine = request.engine
      const metadata: BeadsMetadata = {
        engine: request.engine,
        workerId: opts.workerId,
        timestamp: state.startedAt,
        startedAt: state.startedAt,
      }
      return deps.writeMetadata(opts.issueId, metadata).pipe(
        Effect.catchTag("FatalError", (err) =>
          Effect.logWarning(`Failed to write start metadata for ${opts.issueId}: ${err.message}`),
        ),
      )
    },

    onLoopEvent: (event) => {
      switch (event.type) {
        case "check_failed":
          return deps.addComment(
            opts.issueId,
            formatCheckFailedComment(
              event.attempt,
              event.maxAttempts,
              event.feedback ?? "",
            ),
          )
        case "success":
          return deps.addComment(
            opts.issueId,
            formatSuccessComment(event.attempt, event.maxAttempts),
          )
        default:
          return Effect.void
      }
    },

    onAgentResult: (result, attempt, maxAttempts) =>
      deps.addComment(
        opts.issueId,
        formatSessionComment(state.engine, attempt, maxAttempts, result.resumeToken),
      ),

    onComplete: (result) => {
      const finishedAt = new Date().toISOString()
      const finalMetadata: BeadsMetadata = {
        engine: result.engine,
        resumeToken: result.resumeToken,
        workerId: opts.workerId,
        timestamp: finishedAt,
        startedAt: state.startedAt!,
        finishedAt,
      }
      return deps.writeMetadata(opts.issueId, finalMetadata).pipe(
        Effect.catchTag("FatalError", (err) =>
          Effect.logWarning(`Failed to write final metadata for ${opts.issueId}: ${err.message}`),
        ),
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Watch-mode request factory
// ---------------------------------------------------------------------------

/**
 * Build a pure-data RunRequest from Beads issue context.
 *
 * This is the watch-specific counterpart to the CLI request assembly in
 * cli.ts. Differences from direct-run assembly:
 * - Task text comes from issue fields (title, description, design, etc.)
 * - Epic PRD preamble is prepended when the task belongs to an epic
 * - Previous error context is appended when retrying a failed task
 * - No CLI flag overrides — all settings come from config
 */
export const buildWatchRequest = (
  issue: BeadsIssue,
  config: RalpheConfig,
  previousError?: string,
  buildPromptFromIssue: (issue: BeadsIssue) => string = defaultBuildPromptFromIssue,
  /** Optional epic PRD preamble to prepend to the task prompt. */
  epicPreamble?: string,
  /** Optional working directory (epic worktree path) for execution. */
  cwd?: string,
): RunRequest => {
  let task = ""
  if (epicPreamble) {
    task += epicPreamble + "\n"
  }
  task += buildPromptFromIssue(issue)
  if (previousError) {
    task += `\n\n## Previous Error\n${previousError}`
  }
  return {
    task,
    engine: config.engine,
    checks: config.checks,
    maxAttempts: config.maxAttempts,
    gitMode: config.git.mode,
    reportMode: config.report,
    cwd,
  }
}
