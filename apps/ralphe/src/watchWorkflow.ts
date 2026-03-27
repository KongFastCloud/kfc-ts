/**
 * ABOUTME: Shared Effect-native watch-task workflow.
 * Canonical task-processing pipeline covering queued-task discovery,
 * claim handling, workspace preparation via blueprints pipeline,
 * previous-error loading, and task execution through the shared
 * workflow builder (buildRunWorkflow).
 *
 * Both headless watch and TUI watch consume this shared workflow to avoid
 * duplicated watch-domain logic. In-flight Beads lifecycle writes (metadata,
 * comments) are owned by the BeadsRunObserver. Post-execution status
 * transitions (close, mark exhausted) remain here because they need to
 * propagate FatalError.
 */

import { Effect, Layer } from "effect"
import { FatalError } from "./errors.js"
import { loadConfig, type RalpheConfig } from "./config.js"
import { buildRunWorkflow } from "./buildRunWorkflow.js"
import { makeBeadsRunObserver, buildWatchRequest, type BeadsObserverState } from "./BeadsRunObserver.js"
import { RunObserver } from "./RunObserver.js"
import { EngineResolver, DefaultEngineResolverLayer } from "./EngineResolver.js"
import { queryQueued, queryTaskDetail } from "./beadsAdapter.js"
import {
  claimTask,
  closeTaskSuccess,
  writeMetadata,
  readMetadata,
  addLabel,
  removeLabel,
  buildPromptFromIssue,
  markTaskExhaustedFailure,
  addComment,
  type BeadsIssue,
  type BeadsMetadata,
} from "./beads.js"
import {
  loadEpicContext,
  buildEpicPreamble,
  EPIC_ERROR_MISSING_BRANCH,
  type EpicContext,
} from "./epic.js"
import { ensureEpicWorktree, deriveEpicWorktreePath, getRepoRoot } from "./epicWorktree.js"
import { workspacePrepare as defaultWorkspacePrepare } from "@workspace/blueprints"
import type { WorkspacePrepareInput, WorkspacePrepareResult } from "@workspace/blueprints"
import { getEpicRuntimeStatus, setEpicRuntimeStatus } from "./epicRuntimeState.js"

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

export interface WatchWorkflowDeps {
  readonly loadConfig: typeof loadConfig
  readonly queryQueued: typeof queryQueued
  readonly queryTaskDetail: typeof queryTaskDetail
  readonly claimTask: typeof claimTask
  readonly readMetadata: typeof readMetadata
  readonly buildPromptFromIssue: typeof buildPromptFromIssue
  // Beads write operations (observer uses writeMetadata + addComment;
  // processClaimedTask uses closeTaskSuccess + markTaskExhaustedFailure)
  readonly writeMetadata: typeof writeMetadata
  readonly addLabel: typeof addLabel
  readonly removeLabel: typeof removeLabel
  readonly closeTaskSuccess: typeof closeTaskSuccess
  readonly markTaskExhaustedFailure: typeof markTaskExhaustedFailure
  readonly addComment: typeof addComment
  // Engine resolver layer for the workflow builder
  readonly engineResolverLayer: Layer.Layer<EngineResolver>
  // Epic worktree lifecycle (lazily create or reuse the epic worktree)
  readonly ensureEpicWorktree: typeof ensureEpicWorktree
  // Epic worktree path derivation (pure path resolution, no creation)
  readonly deriveEpicWorktreePath: typeof deriveEpicWorktreePath
  // Repository root for workspace-prepare source workspace
  readonly getRepoRoot: typeof getRepoRoot
  // Epic local runtime bootstrap state
  readonly getEpicRuntimeStatus: typeof getEpicRuntimeStatus
  readonly setEpicRuntimeStatus: typeof setEpicRuntimeStatus
  // Blueprints workspace-prepare pipeline (ensure → copy-ignored → bootstrap)
  readonly workspacePrepare: typeof defaultWorkspacePrepare
}

// ---------------------------------------------------------------------------
// Core task lifecycle: claim -> read metadata -> execute -> finalize
// ---------------------------------------------------------------------------

/**
 * Process a single claimed task through the full lifecycle.
 *
 * Assumes the task has already been claimed by the caller. Handles:
 * - Previous-error loading from metadata
 * - Request assembly via the watch-specific factory
 * - Task execution through the shared workflow builder (buildRunWorkflow)
 * - In-flight Beads lifecycle writes via BeadsRunObserver (metadata, comments)
 * - Post-execution status transitions (close or mark exhausted)
 *
 * Logs are annotated with taskId and issueTitle, wrapped in a "task" span
 * for structured observability.
 */
export const processClaimedTask = (
  issue: BeadsIssue,
  config: RalpheConfig,
  workerId: string,
  depsOverride?: Partial<WatchWorkflowDeps>,
): Effect.Effect<ProcessTaskResult, FatalError> =>
  Effect.gen(function* () {
    const deps: WatchWorkflowDeps = {
      loadConfig,
      queryQueued,
      queryTaskDetail,
      claimTask,
      readMetadata,
      buildPromptFromIssue,
      writeMetadata,
      addLabel,
      removeLabel,
      closeTaskSuccess,
      markTaskExhaustedFailure,
      addComment,
      engineResolverLayer: DefaultEngineResolverLayer,
      ensureEpicWorktree,
      deriveEpicWorktreePath,
      getRepoRoot,
      getEpicRuntimeStatus,
      setEpicRuntimeStatus,
      workspacePrepare: defaultWorkspacePrepare,
      ...depsOverride,
    }

    // -----------------------------------------------------------------------
    // Epic context validation: tasks must belong to a valid epic
    // -----------------------------------------------------------------------

    const epicResult = yield* loadEpicContext(
      issue.parentId,
      deps.queryTaskDetail,
    ).pipe(Effect.either)

    if (epicResult._tag === "Left") {
      // Invalid epic context — mark the task as errored with a clear reason
      const reason = issue.parentId && epicResult.left === EPIC_ERROR_MISSING_BRANCH(issue.parentId)
        ? "epic_uninitialized"
        : epicResult.left
      yield* Effect.logWarning(`Epic context invalid for task ${issue.id}: ${reason}`)
      const now = new Date().toISOString()
      yield* deps.markTaskExhaustedFailure(
        issue.id,
        reason,
        {
          engine: config.engine,
          workerId,
          timestamp: now,
          startedAt: now,
          finishedAt: now,
        },
      )
      return {
        success: false,
        taskId: issue.id,
        engine: config.engine,
        error: reason,
      }
    }

    const epicContext: EpicContext = epicResult.right
    const epicPreamble = buildEpicPreamble(epicContext)

    // -----------------------------------------------------------------------
    // Epic workspace lifecycle: prepare or reuse the epic worktree
    // -----------------------------------------------------------------------

    // Derive the canonical worktree path (pure path resolution, no creation)
    const worktreePathResult = yield* deps.deriveEpicWorktreePath(epicContext.id).pipe(Effect.either)
    if (worktreePathResult._tag === "Left") {
      const reason = `Failed to derive epic worktree path: ${worktreePathResult.left.message}`
      yield* Effect.logWarning(`Worktree path resolution failed for task ${issue.id}: ${reason}`)
      const now = new Date().toISOString()
      yield* deps.markTaskExhaustedFailure(
        issue.id,
        reason,
        {
          engine: config.engine,
          workerId,
          timestamp: now,
          startedAt: now,
          finishedAt: now,
        },
      )
      return {
        success: false,
        taskId: issue.id,
        engine: config.engine,
        error: reason,
      }
    }
    const epicWorktreePath = worktreePathResult.right
    const runtimeStatus = yield* deps.getEpicRuntimeStatus(epicContext.id)

    if (runtimeStatus !== "ready") {
      if (runtimeStatus === "error") {
        // Best-effort cleanup for operator visibility before retrying.
        yield* deps.removeLabel(epicContext.id, "error").pipe(
          Effect.catchTag("FatalError", (error) =>
            Effect.logWarning(`Could not clear epic error label for ${epicContext.id}: ${error.message}`),
          ),
        )
      }

      // Full workspace-prepare pipeline: ensure → copy-ignored → bootstrap
      const repoRootResult = yield* deps.getRepoRoot().pipe(Effect.either)
      if (repoRootResult._tag === "Left") {
        const reason = `Failed to resolve repository root: ${repoRootResult.left.message}`
        yield* Effect.logWarning(`Repository root resolution failed for task ${issue.id}: ${reason}`)
        const now = new Date().toISOString()
        yield* deps.markTaskExhaustedFailure(
          issue.id,
          reason,
          {
            engine: config.engine,
            workerId,
            timestamp: now,
            startedAt: now,
            finishedAt: now,
          },
        )
        return {
          success: false,
          taskId: issue.id,
          engine: config.engine,
          error: reason,
        }
      }
      const repoRoot = repoRootResult.right
      const prepareResult = yield* deps.workspacePrepare({
        worktreePath: epicWorktreePath,
        branch: epicContext.branch,
        sourceWorkspace: repoRoot,
        sourceCwd: repoRoot,
      }).pipe(Effect.either)

      if (prepareResult._tag === "Left") {
        const prepareReason = `Workspace prepare failed: ${prepareResult.left.message}`

        // Local runtime state write is best-effort — task failure still proceeds.
        yield* deps.setEpicRuntimeStatus(epicContext.id, "error", prepareResult.left.message).pipe(
          Effect.catchTag("FatalError", (error) =>
            Effect.logWarning(`Could not persist epic runtime error state for ${epicContext.id}: ${error.message}`),
          ),
        )
        // Label writes are also best-effort to avoid masking root pipeline failures.
        yield* deps.addLabel(epicContext.id, "error").pipe(
          Effect.catchTag("FatalError", (error) =>
            Effect.logWarning(`Could not add epic error label for ${epicContext.id}: ${error.message}`),
          ),
        )
        // Keep workspace-prepare diagnostics visible on the task thread.
        yield* deps.addComment(
          issue.id,
          `Workspace prepare failed for epic "${epicContext.id}" in worktree "${epicWorktreePath}": ${prepareResult.left.message}`,
        ).pipe(
          Effect.catchAll(() =>
            Effect.logWarning(`Could not write workspace prepare failure comment for task ${issue.id}.`),
          ),
        )

        yield* Effect.logWarning(`Workspace prepare failed for task ${issue.id}: ${prepareReason}`)
        const now = new Date().toISOString()
        yield* deps.markTaskExhaustedFailure(
          issue.id,
          prepareReason,
          {
            engine: config.engine,
            workerId,
            timestamp: now,
            startedAt: now,
            finishedAt: now,
          },
        )
        return {
          success: false,
          taskId: issue.id,
          engine: config.engine,
          error: prepareReason,
        }
      }

      const runtimeWrite = yield* deps.setEpicRuntimeStatus(epicContext.id, "ready").pipe(Effect.either)
      if (runtimeWrite._tag === "Left") {
        const reason = `Failed to persist epic runtime state: ${runtimeWrite.left.message}`
        yield* Effect.logWarning(`Runtime state write failed for task ${issue.id}: ${reason}`)
        const now = new Date().toISOString()
        yield* deps.markTaskExhaustedFailure(
          issue.id,
          reason,
          {
            engine: config.engine,
            workerId,
            timestamp: now,
            startedAt: now,
            finishedAt: now,
          },
        )
        return {
          success: false,
          taskId: issue.id,
          engine: config.engine,
          error: reason,
        }
      }

      // Best-effort: clear stale epic error label after successful pipeline run.
      yield* deps.removeLabel(epicContext.id, "error").pipe(
        Effect.catchTag("FatalError", (error) =>
          Effect.logWarning(`Could not clear epic error label for ${epicContext.id}: ${error.message}`),
        ),
      )
    } else {
      // Runtime already ready — just ensure the worktree still exists
      const ensureResult = yield* deps.ensureEpicWorktree(epicContext).pipe(Effect.either)

      if (ensureResult._tag === "Left") {
        const reason = `Failed to ensure epic worktree: ${ensureResult.left.message}`
        yield* Effect.logWarning(`Worktree setup failed for task ${issue.id}: ${reason}`)
        const now = new Date().toISOString()
        yield* deps.markTaskExhaustedFailure(
          issue.id,
          reason,
          {
            engine: config.engine,
            workerId,
            timestamp: now,
            startedAt: now,
            finishedAt: now,
          },
        )
        return {
          success: false,
          taskId: issue.id,
          engine: config.engine,
          error: reason,
        }
      }
    }

    // Read existing metadata before overwriting to capture previous error
    const existingMeta = yield* Effect.either(deps.readMetadata(issue.id))
    const previousError = existingMeta._tag === "Right" ? existingMeta.right?.error : undefined

    // Build pure-data request via watch-specific factory (now with epic preamble and worktree cwd)
    const request = buildWatchRequest(issue, config, previousError, deps.buildPromptFromIssue, epicPreamble, epicWorktreePath)

    // Observer state is shared so processClaimedTask can read startedAt
    // for the final metadata written during status transitions.
    const observerState: BeadsObserverState = { startedAt: undefined, engine: config.engine }

    // Build observer with injected Beads operations for testability
    const beadsObserver = makeBeadsRunObserver(
      { issueId: issue.id, workerId },
      {
        writeMetadata: deps.writeMetadata,
        addComment: deps.addComment,
      },
      observerState,
    )

    // Execute through the shared workflow builder — same path as direct runs
    const result = yield* Effect.provide(
      buildRunWorkflow(request),
      Layer.merge(
        deps.engineResolverLayer,
        Layer.succeed(RunObserver, beadsObserver),
      ),
    )

    // Post-execution status transitions (can propagate FatalError)
    if (result.success) {
      yield* deps.closeTaskSuccess(issue.id)
      yield* Effect.logInfo(`Task completed successfully.`)
    } else {
      // Exhausted failure: keep task open, remove eligibility, mark error
      const finishedAt = new Date().toISOString()
      yield* deps.markTaskExhaustedFailure(
        issue.id,
        result.error || "execution failed",
        {
          engine: result.engine,
          resumeToken: result.resumeToken,
          workerId,
          timestamp: finishedAt,
          startedAt: observerState.startedAt ?? finishedAt,
          finishedAt,
        },
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
  depsOverride?: Partial<WatchWorkflowDeps>,
): Effect.Effect<PollResult, FatalError> =>
  Effect.gen(function* () {
    const deps: WatchWorkflowDeps = {
      loadConfig,
      queryQueued,
      queryTaskDetail,
      claimTask,
      readMetadata,
      buildPromptFromIssue,
      writeMetadata,
      addLabel,
      removeLabel,
      closeTaskSuccess,
      markTaskExhaustedFailure,
      addComment,
      engineResolverLayer: DefaultEngineResolverLayer,
      ensureEpicWorktree,
      deriveEpicWorktreePath,
      getRepoRoot,
      getEpicRuntimeStatus,
      setEpicRuntimeStatus,
      workspacePrepare: defaultWorkspacePrepare,
      ...depsOverride,
    }
    const config = deps.loadConfig(workDir)

    // Poll for queued tasks (open + ready + no error + not blocked)
    const ready = yield* deps.queryQueued(workDir)

    if (ready.length === 0) {
      return { _tag: "NoneReady" as const }
    }

    const issue = ready[0]!
    yield* Effect.logInfo(`Found ready task: ${issue.id}`)

    // Claim atomically
    const claimed = yield* deps.claimTask(issue.id)
    if (!claimed) {
      yield* Effect.logInfo(`Task ${issue.id} already claimed by another worker. Skipping.`)
      return { _tag: "ClaimContention" as const, taskId: issue.id, title: issue.title }
    }

    yield* Effect.logInfo(`Claimed task: ${issue.id}`)

    const result = yield* processClaimedTask(issue, config, workerId, deps)
    return { _tag: "Processed" as const, result }
  })
