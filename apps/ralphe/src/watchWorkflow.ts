/**
 * ABOUTME: Shared Effect-native watch-task workflow.
 * Canonical task-processing pipeline covering queued-task discovery,
 * claim handling, previous-error loading, metadata writes, task execution,
 * and success or exhausted-failure finalization.
 *
 * Both headless watch and TUI watch consume this shared workflow to avoid
 * duplicated watch-domain logic.
 */

import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { loadConfig, type RalpheConfig } from "./config.js"
import { runTask } from "./runTask.js"
import { queryQueued } from "./beadsAdapter.js"
import {
  claimTask,
  closeTaskSuccess,
  writeMetadata,
  readMetadata,
  buildPromptFromIssue,
  markTaskExhaustedFailure,
  type BeadsIssue,
  type BeadsMetadata,
} from "./beads.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of processing a single claimed task through the full lifecycle.
 */
export interface ProcessTaskResult {
  readonly success: boolean
  readonly taskId: string
  readonly engine: "claude" | "codex"
  readonly resumeToken?: string | undefined
  readonly error?: string | undefined
}

/**
 * Outcome of a single poll-claim-process cycle.
 */
export type PollResult =
  | { readonly _tag: "NoneReady" }
  | { readonly _tag: "ClaimContention"; readonly taskId: string; readonly title: string }
  | { readonly _tag: "Processed"; readonly result: ProcessTaskResult }

// ---------------------------------------------------------------------------
// Core task lifecycle: claim → read metadata → execute → finalize
// ---------------------------------------------------------------------------

/**
 * Process a single claimed task through the full lifecycle.
 *
 * Assumes the task has already been claimed by the caller. Handles:
 * - Previous-error loading from metadata
 * - Start metadata write
 * - Prompt building with previous-error context
 * - Task execution via runTask
 * - Final metadata write with resume token and timing
 * - Success finalization (close) or exhausted-failure marking
 *
 * Logs are annotated with taskId and issueTitle, wrapped in a "task" span
 * for structured observability.
 */
export const processClaimedTask = (
  issue: BeadsIssue,
  config: RalpheConfig,
  workerId: string,
): Effect.Effect<ProcessTaskResult, FatalError> =>
  Effect.gen(function* () {
    // Read existing metadata before overwriting to capture previous error
    const existingMeta = yield* Effect.either(readMetadata(issue.id))
    const previousError = existingMeta._tag === "Right" ? existingMeta.right?.error : undefined

    // Write initial metadata
    const startedAt = new Date().toISOString()
    const startMetadata: BeadsMetadata = {
      engine: config.engine,
      workerId,
      timestamp: startedAt,
      startedAt,
    }
    yield* writeMetadata(issue.id, startMetadata)

    // Build prompt and execute
    let prompt = buildPromptFromIssue(issue)
    if (previousError) {
      prompt += `\n\n## Previous Error\n${previousError}`
    }
    const result = yield* runTask(prompt, config, { issueId: issue.id })

    // Write final metadata with resume token
    const finishedAt = new Date().toISOString()
    const finalMetadata: BeadsMetadata = {
      engine: result.engine,
      resumeToken: result.resumeToken,
      workerId,
      timestamp: finishedAt,
      startedAt,
      finishedAt,
    }

    // Close with appropriate outcome
    if (result.success) {
      yield* writeMetadata(issue.id, finalMetadata)
      yield* closeTaskSuccess(issue.id)
      yield* Effect.logInfo(`Task completed successfully.`)
    } else {
      // Exhausted failure: keep task open, remove eligibility, mark error
      yield* markTaskExhaustedFailure(
        issue.id,
        result.error ?? "execution failed",
        finalMetadata,
      )
      yield* Effect.logWarning(`Task exhausted all retries — marked as error (task remains open).`)
    }

    return {
      success: result.success,
      taskId: issue.id,
      engine: result.engine,
      resumeToken: result.resumeToken,
      error: result.error,
    }
  }).pipe(
    Effect.annotateLogs({ taskId: issue.id, issueTitle: issue.title }),
    Effect.withLogSpan("task"),
  )

// ---------------------------------------------------------------------------
// Poll, claim, and process one task
// ---------------------------------------------------------------------------

/**
 * Single poll-claim-process cycle.
 *
 * Queries for queued tasks, attempts to claim the first one, and if
 * successful, processes it through the full task lifecycle. Returns a
 * discriminated union describing the outcome:
 *
 * - `NoneReady`: No tasks available in the queue.
 * - `ClaimContention`: A task was found but another worker claimed it first.
 * - `Processed`: A task was claimed and processed (check `result.success`).
 */
export const pollClaimAndProcess = (
  workDir: string,
  workerId: string,
): Effect.Effect<PollResult, FatalError> =>
  Effect.gen(function* () {
    const config = loadConfig(workDir)

    // Poll for queued tasks (open + ready + no error + not blocked)
    const ready = yield* queryQueued(workDir)

    if (ready.length === 0) {
      return { _tag: "NoneReady" as const }
    }

    const issue = ready[0]!
    yield* Effect.logInfo(`Found ready task: ${issue.id} — ${issue.title}`)

    // Claim atomically
    const claimed = yield* claimTask(issue.id)
    if (!claimed) {
      yield* Effect.logDebug(`Task ${issue.id} already claimed by another worker. Skipping.`)
      return { _tag: "ClaimContention" as const, taskId: issue.id, title: issue.title }
    }

    yield* Effect.logInfo(`Claimed task: ${issue.id}`)

    const result = yield* processClaimedTask(issue, config, workerId)
    return { _tag: "Processed" as const, result }
  })
