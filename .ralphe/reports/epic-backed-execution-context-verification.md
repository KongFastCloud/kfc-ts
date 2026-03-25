# Verification Report: Epic-Backed Execution Context for Tasks

**Date:** 2026-03-26
**Status:** PASS

## Summary

The epic-backed execution context feature is correctly implemented. All acceptance criteria are met, with comprehensive test coverage across 48 tests (17 epic domain model + 31 watch workflow including 8 epic-specific integration tests).

## Acceptance Criteria Verification

### 1. Epics are represented as non-runnable Beads issues labeled `epic`
**PASS** — `src/epic.ts` defines `EpicContext` with a required `labels` field that must include `"epic"`. The `validateEpicContext` function enforces this at line 72: `if (!labels.includes("epic"))` returns an explicit error. Epics are never executed directly; only child tasks run through the workflow.

### 2. Runnable tasks must belong to exactly one epic through the Beads parent relationship
**PASS** — `loadEpicContext()` requires a `parentId` and rejects tasks without one via `EPIC_ERROR_NO_PARENT`. The `beads.ts` parent inference (line 110-116) derives parentId from either the explicit `parent` field or dotted ID notation (e.g., `"epic-1.task-2"` → parentId `"epic-1"`).

### 3. Parent-child structure is the source of truth for epic membership during execution
**PASS** — `processClaimedTask` in `watchWorkflow.ts` (line 118-145) loads epic context via `loadEpicContext(issue.parentId, ...)` as the first step before any execution. The parent-child relationship (via `parentId`) is the sole mechanism for determining epic membership.

### 4. The executor loads child task content plus full parent epic body and required epic metadata
**PASS** — When epic context is valid:
- Epic body is loaded via `loadEpicContext()` → `queryTaskDetail(parentId)`
- Epic preamble is built via `buildEpicPreamble(epicContext)` → `"## Epic: {title}\n\n{body}\n\n---\n"`
- Preamble is prepended to the task prompt via `buildWatchRequest(issue, config, previousError, buildPromptFromIssue, epicPreamble)`
- The `EpicContext` type carries `id`, `title`, `body`, and `labels`

### 5. Tasks with invalid or missing epic context fail explicitly rather than falling back
**PASS** — Four explicit error paths exist with no fallback behavior:
- `EPIC_ERROR_NO_PARENT`: Standalone task (no parentId)
- `EPIC_ERROR_PARENT_NOT_FOUND(parentId)`: Parent issue cannot be loaded
- `EPIC_ERROR_MISSING_LABEL(parentId)`: Parent lacks "epic" label
- `EPIC_ERROR_EMPTY_BODY(parentId)`: Epic has no PRD body

All failures call `markTaskExhaustedFailure` with the error reason, timing metadata, and worker info. No agent execution occurs.

### 6. Standalone tasks are not treated as valid execution inputs in the new model
**PASS** — Tests confirm standalone tasks (no parentId) are rejected immediately:
- `processClaimedTask` returns `{ success: false, error: EPIC_ERROR_NO_PARENT }`
- `markTaskExhaustedFailure` is called
- No `writeMetadata` from observer (agent never starts)
- Works in both direct `processClaimedTask` and `pollClaimAndProcess` paths

## Test Results

```
epic.test.ts:        17 pass, 0 fail (42 assertions)
watchWorkflow.test.ts: 31 pass, 0 fail (123 assertions)
```

### Epic-Specific Test Coverage (watchWorkflow.test.ts Contract 8)
| Test | Result |
|------|--------|
| Standalone task (no parentId) rejected with explicit error | PASS |
| Task whose parent is not found is rejected | PASS |
| Task whose parent lacks epic label is rejected | PASS |
| Task whose parent epic has empty body is rejected | PASS |
| Task with valid epic parent executes successfully | PASS |
| Epic PRD is prepended to task prompt | PASS |
| Invalid epic context marks task as exhausted failure with timing | PASS |
| Standalone task in poll queue is rejected during processing | PASS |

## Architecture Notes

- **Domain model**: `src/epic.ts` (154 lines) — types, validation, loading, preamble building
- **Execution integration**: `src/watchWorkflow.ts` — epic validation as first step of `processClaimedTask`
- **Request assembly**: `src/BeadsRunObserver.ts` — `buildWatchRequest` accepts optional `epicPreamble`
- **Public API**: All epic types and functions exported from `src/index.ts`
- **No worktree or TUI changes**: Correctly scoped to domain model and execution context only
