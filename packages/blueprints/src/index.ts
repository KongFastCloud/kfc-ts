/**
 * ABOUTME: Public API for the @workspace/blueprints primitives package.
 *
 * Blueprints is a primitives-first execution toolkit. Apps (ralphe, ralphly)
 * compose their own workflows from these building blocks. The package owns
 * reusable execution steps and low-level combinators but does not own
 * orchestration policy — that is an app concern.
 *
 * ## Supported primitive surface
 *
 * - Engine interface and agent result types
 * - Retry loop primitive and loop event types
 * - Agent execution step
 * - Command execution step
 * - Verification report step
 * - Git primitives (commit, push, CI wait, dirty check)
 * - Git composition helpers (buildCiGitStep, executePostLoopGitOps)
 * - Shared tagged error types (CheckFailure, FatalError)
 *
 * ## What apps own
 *
 * - Workflow assembly and step ordering
 * - Lifecycle observers and side effects
 * - Prompt construction policy
 * - Tracker integration (Linear, Beads, etc.)
 * - Durable queueing and scheduling
 * - Tracing and telemetry
 */

// ============================================================================
// Engine interface (callers provide implementations)
// ============================================================================

export { Engine } from "./engine.js"
export type { AgentResult } from "./engine.js"

// ============================================================================
// Error types
// ============================================================================

export { CheckFailure, FatalError } from "./errors.js"

// ============================================================================
// Loop primitive
// ============================================================================

export { loop } from "./loop.js"
export type { LoopEvent, LoopEventType, LoopOptions } from "./loop.js"

// ============================================================================
// Execution steps
// ============================================================================

// Agent step — execute a task via Engine with optional retry feedback
export { agent } from "./agent.js"
export type { AgentOptions } from "./agent.js"

// Command step — run shell commands for validation checks
export { cmd } from "./cmd.js"
export type { CmdResult } from "./cmd.js"

// Report step — run a verification agent and parse structured JSON response
export { report } from "./report.js"
export type { ReportResult, ReportOptions } from "./report.js"

// ============================================================================
// Git primitives
// ============================================================================

export {
  gitCommit,
  gitPush,
  gitWaitForCi,
  isWorktreeDirty,
} from "./git.js"
export type {
  GitCommitResult,
  GitPushResult,
  GitHubCiResult,
} from "./git.js"

// ============================================================================
// Git composition helpers
// ============================================================================

export { buildCiGitStep, executePostLoopGitOps, defaultGitOps } from "./git-steps.js"
export type { GitMode, GitOps } from "./git-steps.js"

// ============================================================================
// Transitional: shared runner
//
// The run() function and its supporting types exist for backward compatibility
// while consumers migrate to primitives-based workflow assembly. New code
// should compose workflows directly from the primitives above.
// ============================================================================

/** @deprecated Use primitives-based workflow assembly instead. */
export { run } from "./runner.js"
/** @deprecated Use primitives-based workflow assembly instead. */
export type { RunConfig, RunResult, RunnerOptions } from "./runner.js"
