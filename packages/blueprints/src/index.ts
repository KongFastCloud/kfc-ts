/**
 * ABOUTME: Public API for the blueprints execution runner package.
 * Exposes the canonical execution runner, loop primitive, engine interface,
 * error types, and all supporting types needed by callers.
 */

// Core runner
export { run } from "./runner.js"
export type {
  RunConfig,
  RunResult,
  RunnerOptions,
  GitMode,
  GitOps,
} from "./runner.js"

// Loop primitive
export { loop } from "./loop.js"
export type { LoopEvent, LoopEventType, LoopOptions } from "./loop.js"

// Engine interface (callers provide implementations)
export { Engine } from "./engine.js"
export type { AgentResult } from "./engine.js"

// Error types
export { CheckFailure, FatalError } from "./errors.js"

// Agent step (for callers who need lower-level composition)
export { agent } from "./agent.js"
export type { AgentOptions } from "./agent.js"

// Command step
export { cmd } from "./cmd.js"
export type { CmdResult } from "./cmd.js"

// Report step
export { report } from "./report.js"
export type { ReportResult, ReportOptions } from "./report.js"

// Git operations
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

// Git step helpers (for callers who need lower-level composition)
export { buildCiGitStep, executePostLoopGitOps } from "./runner.js"
