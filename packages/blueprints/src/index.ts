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
// Workspace lifecycle primitives
// ============================================================================

export {
  sanitizeWorkspaceId,
  getRepoRoot,
  worktreeExistsAt,
  getWorktreeBranch,
  createWorktree,
  removeWorktree,
  recreateWorktree,
  ensureWorktree,
  getWorktreeState,
  isWorktreeDirty as isWorkspaceDirty,
  removeWorktreeWithCleanup,
} from "./workspace.js"
export type { WorktreeState, WorktreeCleanupResult } from "./workspace.js"

// ============================================================================
// Bootstrap install primitives
// ============================================================================

export {
  detectPackageManager,
  bootstrapCommandFor,
  bootstrapInstall,
} from "./bootstrap.js"
export type { BootstrapPackageManager } from "./bootstrap.js"

// ============================================================================
// Copy-ignored primitives
// ============================================================================

export {
  discoverIgnoredEntries,
  readWorktreeInclude,
  filterByWorktreeInclude,
  copyIgnored,
} from "./copy.js"
export type { CopyIgnoredResult } from "./copy.js"

