# Verification Report: Linear SDK Session and Issue Loading for Actionable Work

**Date:** 2026-03-24
**Status:** PASS

## Summary

The implementation of Linear SDK session and issue loading for actionable work in `ralphly` has been verified and meets all acceptance criteria.

## Acceptance Criteria Verification

### 1. Ralphly uses the Linear TypeScript SDK to load session and issue data for its configured agent
**PASS**

- `@linear/sdk` v78.0.0 is declared as a dependency in `apps/ralphly/package.json`
- `src/linear/client.ts` creates a `LinearClient` via the SDK and wraps it in an Effect Context service tag (`Linear`) for dependency injection
- `src/linear/sessions.ts` loads sessions via `client.agentSessions()` with pagination and agent filtering
- `src/linear/issues.ts` loads delegated issues via `client.issues()` with server-side delegate filter and pagination
- Both modules eagerly resolve lazy SDK relationships into plain serializable data types

### 2. Ralphly can rehydrate issue and session state directly from Linear during a manual run
**PASS**

- `src/linear/loader.ts` provides `loadCandidateWork()` which loads issues and sessions in parallel and pairs them into `CandidateWork` items
- `rehydrateFromSession(sessionId)` allows rehydrating a work item from a known session ID (e.g., for follow-up prompts)
- `loadSession()` and `loadIssue()` enable direct single-entity rehydration from Linear
- `cli.ts` implements a manual `run` subcommand that loads config, creates a Linear client layer, calls `loadCandidateWork()`, and logs results
- The CLI supports `--dry-run` for config validation without API calls

### 3. The loaded data is sufficient for later readiness classification and task-context building
**PASS**

- `LinearIssueData` includes all fields needed for readiness classification:
  - `state` (workflow state type for terminal detection)
  - `relations` and `inverseRelations` (for dependency/blocking analysis)
  - `parentId` and `childIds` (for parent-child hierarchy)
  - `completedAt`, `canceledAt` (for terminal state detection)
  - `delegateId`, `assigneeId` (for agent delegation tracking)
- `LinearSessionData` includes `status`, `issueId`, `appUserId`, timestamps, and `summary`
- `SessionPrompt` type captures activity history for prompt context
- `buildPromptFromIssue()` assembles task context from issue title and description
- `isTerminal()` classifies issues by completion/cancellation state
- `findActiveSessionsForIssue()` filters and sorts sessions by activity status
- `CandidateWork` pairs session + issue data for downstream consumption

### 4. The integration remains separate from blueprints and does not push tracker-specific logic into the shared runner
**PASS**

- The `blueprints` package (`packages/blueprints/src/`) contains zero Linear imports or dependencies
- The only mention of "Linear" in blueprints is a comment in `runner.ts` stating the runner is "agnostic to Linear, Beads, and tracker-specific concerns"
- All Linear-specific code lives in `apps/ralphly/src/linear/`
- Domain types (`LinearIssueData`, `LinearSessionData`, etc.) are plain serializable interfaces — not SDK model classes
- The architecture cleanly separates: `blueprints` (execution) → `ralphly` (Linear-aware worker)

## Test Results

**All 30 tests pass across 3 test files (131ms):**

- `tests/config.test.ts` — Config loading, env var overrides, validation
- `tests/linear/types.test.ts` — Pure type helpers: `findActiveSessionsForIssue`, `isTerminal`, `buildPromptFromIssue`
- `tests/linear/loader.test.ts` — Work assembly with mock Linear client: pairing, dedup, filtering, edge cases

**TypeScript typecheck passes with zero errors.**

## Test Coverage Details

The loader tests verify:
- Session-issue pairing works correctly
- Deduplication: one candidate per issue, newest active session wins
- Agent filtering: sessions from other agents are excluded
- Issues without sessions are skipped
- Issues with only terminal sessions are included for downstream classification
- Multiple issues with respective sessions are handled correctly
- Prompt building from loaded issue data produces correct output

The types tests verify:
- Active session filtering excludes terminal statuses (complete, error, stale)
- Active sessions are sorted newest-first
- Terminal issue detection covers all terminal states (completed, canceled, duplicate)
- Non-terminal states (started, backlog) are correctly classified
- Prompt includes title, description section header, and maintains correct ordering

## Architecture Quality

- **Effect-based DI**: Linear client is injected via Effect Context tags and Layers, enabling clean test mocking
- **Pagination**: Both session and issue loading handle pagination automatically
- **Error handling**: All API calls are wrapped in `Effect.tryPromise` with descriptive `FatalError` instances
- **Separation of concerns**: Plain data types decouple from SDK lazy models; downstream code works with serializable snapshots
- **Testability**: Mock Linear client factory enables testing assembly logic without API access
