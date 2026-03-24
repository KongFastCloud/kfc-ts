/**
 * ABOUTME: Public API surface for ralphly.
 * Re-exports configuration types and loading for use by tests and future modules.
 */

export { loadConfig, saveConfig, getConfigPath } from "./config.js"
export type { RalphlyConfig, LinearIdentity, ConfigError } from "./config.js"
export { FatalError } from "./errors.js"

// Engine
export { ClaudeEngineLayer } from "./engine.js"

// Readiness classification
export {
  classifyIssue,
  classifyAll,
  buildClassificationContext,
  isReadyWorkflowCategory,
} from "./readiness.js"
export type {
  IssueReadiness,
  ClassifiedWork,
  ClassificationContext,
} from "./readiness.js"

// Backlog selection
export {
  selectNext,
  selectAllActionable,
  formatBacklogSummary,
} from "./backlog.js"
export type {
  BacklogSelection,
  BacklogSummary,
} from "./backlog.js"

// Runner
export { runIssue, buildTaskInput } from "./runner.js"
export type { IssueRunResult, RunIssueOptions } from "./runner.js"

// Error-hold
export { ErrorHoldStore, buildFailureSummary } from "./error-hold.js"
export type { ErrorHoldRecord } from "./error-hold.js"

// Worker
export {
  runWorkerLoop,
  runWorkerIteration,
  findPromptedFollowUp,
} from "./worker.js"
export type {
  WorkerOptions,
  WorkerIterationResult,
  WorkerRunSummary,
} from "./worker.js"

// Linear integration
export {
  Linear,
  makeLinearLayer,
  loadCandidateWork,
  rehydrateFromSession,
  buildPromptFromIssue,
  loadSession,
  loadSessions,
  loadSessionActivities,
  loadIssue,
  loadDelegatedIssues,
  isTerminal,
  findActiveSessionsForIssue,
  writeSessionActivity,
  writeStartActivity,
  writeErrorActivity,
  makeSessionEventHandler,
  mapLoopEventToActivity,
  formatStartActivity,
  formatCheckFailedActivity,
  formatSuccessActivity,
  formatErrorActivity,
} from "./linear/index.js"
export type {
  LinearIssueData,
  LinearSessionData,
  LinearWorkflowState,
  LinearIssueRelation,
  CandidateWork,
  SessionPrompt,
  AgentSessionStatusValue,
  ActivityContentType,
  SessionUpdateKind,
} from "./linear/index.js"
