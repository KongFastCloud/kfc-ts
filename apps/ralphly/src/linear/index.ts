/**
 * ABOUTME: Public API for ralphly's Linear integration layer.
 * Exposes session/issue loading, work assembly, session activity writing,
 * and the Linear client service.
 */

// Client and service tag
export { Linear, makeLinearLayer, makeLinearLayerFromClient } from "./client.js"

// Session operations
export {
  loadSession,
  loadSessions,
  loadSessionActivities,
  findActiveSessionsForIssue,
} from "./sessions.js"

// Issue operations
export {
  loadIssue,
  loadDelegatedIssues,
  isTerminal,
} from "./issues.js"

// High-level work loading
export {
  loadCandidateWork,
  rehydrateFromSession,
  buildPromptFromIssue,
} from "./loader.js"

// Session activity writing
export {
  writeSessionActivity,
  writeStartActivity,
  writeSuccessActivity,
  writeCheckFailedActivity,
  writeErrorActivity,
  makeSessionEventHandler,
  mapLoopEventToActivity,
  formatStartActivity,
  formatCheckFailedActivity,
  formatSuccessActivity,
  formatErrorActivity,
} from "./activities.js"

// Types
export type {
  LinearIssueData,
  LinearSessionData,
  LinearWorkflowState,
  LinearIssueRelation,
  LinearRelationType,
  WorkflowStateType,
  AgentSessionStatusValue,
  SessionPrompt,
  CandidateWork,
} from "./types.js"

export type {
  ActivityContentType,
  ActivityContent,
  SessionUpdateKind,
} from "./activities.js"
