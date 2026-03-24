/**
 * ABOUTME: Full-lifecycle observer service for the direct run path.
 * Owns all run-related side effects: start, loop-event, agent-result,
 * and completion reactions. Composable so ralphe can combine CLI logging
 * with Beads comments or other observers without coupling them into the
 * workflow builder.
 */

import { Context, Effect } from "effect"
import type { LoopEvent } from "./loop.js"
import type { AgentResult } from "./engine/Engine.js"
import type { RunRequest } from "./RunRequest.js"
import type { TaskResult } from "./TaskResult.js"

/**
 * Lifecycle observer for a single run invocation.
 * Implementations decide what side effects to perform at each phase.
 */
export interface RunObserver {
  /** Called once at the start of a run, before any execution. */
  readonly onStart: (request: RunRequest) => Effect.Effect<void>
  /** Called on each loop lifecycle event (attempt_start, check_failed, success). */
  readonly onLoopEvent: (event: LoopEvent) => Effect.Effect<void>
  /** Called after each agent execution completes within a loop attempt. */
  readonly onAgentResult: (
    result: AgentResult,
    attempt: number,
    maxAttempts: number,
  ) => Effect.Effect<void>
  /** Called once at the end of a run, with the final result (success or failure). */
  readonly onComplete: (result: TaskResult) => Effect.Effect<void>
}

export const RunObserver = Context.GenericTag<RunObserver>("RunObserver")

// ---------------------------------------------------------------------------
// Built-in observer implementations
// ---------------------------------------------------------------------------

/**
 * No-op observer that performs no side effects.
 * Useful for testing or headless batch scenarios.
 */
export const SilentRunObserver: RunObserver = {
  onStart: () => Effect.void,
  onLoopEvent: () => Effect.void,
  onAgentResult: () => Effect.void,
  onComplete: () => Effect.void,
}

/**
 * Logging observer for direct CLI runs.
 * Emits structured log messages at each lifecycle phase.
 */
export const LogRunObserver: RunObserver = {
  onStart: (request) =>
    Effect.logInfo(
      `Starting run: engine=${request.engine}, checks=${request.checks.length}, maxAttempts=${request.maxAttempts}`,
    ),
  onLoopEvent: () => Effect.void,
  onAgentResult: (_result, _attempt, _maxAttempts) => Effect.void,
  onComplete: (result) =>
    result.success
      ? Effect.logInfo("Run completed successfully.")
      : Effect.logWarning(`Run failed: ${result.error ?? "unknown error"}`),
}

/**
 * Compose multiple observers into one.
 * Each lifecycle method calls all delegates in order.
 */
export const composeObservers = (...observers: readonly RunObserver[]): RunObserver => ({
  onStart: (request) =>
    Effect.all(
      observers.map((o) => o.onStart(request)),
      { discard: true },
    ),
  onLoopEvent: (event) =>
    Effect.all(
      observers.map((o) => o.onLoopEvent(event)),
      { discard: true },
    ),
  onAgentResult: (result, attempt, maxAttempts) =>
    Effect.all(
      observers.map((o) => o.onAgentResult(result, attempt, maxAttempts)),
      { discard: true },
    ),
  onComplete: (result) =>
    Effect.all(
      observers.map((o) => o.onComplete(result)),
      { discard: true },
    ),
})
