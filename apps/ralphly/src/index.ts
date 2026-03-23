/**
 * ABOUTME: Public API surface for ralphly.
 * Re-exports configuration types and loading for use by tests and future modules.
 */

export { loadConfig, saveConfig, getConfigPath } from "./config.js"
export type { RalphlyConfig, LinearIdentity, ConfigError } from "./config.js"
export { FatalError } from "./errors.js"

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
} from "./linear/index.js"
export type {
  LinearIssueData,
  LinearSessionData,
  LinearWorkflowState,
  LinearIssueRelation,
  CandidateWork,
  SessionPrompt,
  AgentSessionStatusValue,
} from "./linear/index.js"
