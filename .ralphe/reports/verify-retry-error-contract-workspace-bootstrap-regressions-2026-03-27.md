# Verification Report: Preserve retry/error contract and add workspace bootstrap regressions

**Date:** 2026-03-27
**Status:** PASS
**Parent epic:** kfc-ts-pe20
**User stories:** #3, #4

## Summary

Verified that the retry/error contract is preserved and workspace bootstrap regression coverage is in place. All four acceptance criteria are met with comprehensive test coverage.

## Test Results

| Test Suite | Tests | Pass | Fail | Assertions |
|---|---|---|---|---|
| `apps/ralphe/tests/retryErrorContract.test.ts` | 29 | 29 | 0 | 69 |
| `apps/ralphe/tests/watchWorkflow.test.ts` | 53 | 53 | 0 | 203 |
| `packages/blueprints/tests/workspace-prepare.test.ts` | 8 | 8 | 0 | 24 |
| `packages/blueprints/tests/copy.test.ts` | 37 | 37 | 0 | — |
| `packages/blueprints/tests/bootstrap.test.ts` | 6 | 6 | 0 | — |
| `packages/blueprints/tests/workspace.test.ts` + `workspace-contract.test.ts` | 30 | 30 | 0 | 53 |
| **Total** | **163** | **163** | **0** | |

## Acceptance Criteria Verification

### AC1: Retry input uses only last structured metadata failure (no comment parsing)

**PASS** — Verified in `retryErrorContract.test.ts`, Contract 1 (6 tests):
- `readMetadata` is called exactly once per task to load `previousError`
- `watchWorkflow.ts` line 317: `const previousError = existingMeta._tag === "Right" ? existingMeta.right?.error : undefined`
- `buildWatchRequest()` accepts only a `previousError: string | undefined` parameter — no comment objects
- When `metadata.error` is present, it appears in `## Previous Error` section of the task prompt
- When `metadata.error` is absent, no previous error section is generated
- Other metadata fields (resumeToken, workerId, timestamps) are never included in retry context

### AC2: Comments continue to log history but are never included in retry context assembly

**PASS** — Verified in `retryErrorContract.test.ts`, Contract 2 (4 tests):
- Comments are written during execution (session, success, failure diagnostics)
- No `readComments` operation exists in the workflow — the only read operation is `readMetadata`
- Failed tasks write errors to metadata via `markTaskExhaustedFailure` (which merges `error: reason` into metadata)
- `buildWatchRequest()` function signature has no parameter for comment objects — API shape enforces the contract
- Sequential retry scenario confirms: second run reads `metadata.error` from first run, never reads comments

### AC3: Workspace-prepare failures trigger existing exhausted-failure/error flow

**PASS** — Verified in `retryErrorContract.test.ts`, Contract 3 (7 tests) and `watchWorkflow.test.ts`:
- Workspace-prepare failure marks task as exhausted with failure reason containing `"Workspace prepare failed: ..."`
- Workspace-prepare failure persists epic runtime error state (`runtimeStateByEpicId` set to `"error"`)
- Workspace-prepare failure adds `"error"` label to epic for operator visibility
- Workspace-prepare failure posts diagnostic comment on the task issue thread
- Workspace-prepare failure does NOT execute the agent (no observer metadata writes, no session/success comments)
- `ensureEpicWorktree` failure (when runtime already `ready`) also triggers the exhausted flow
- Failure reason is preserved in metadata for next retry attempt

Implementation in `watchWorkflow.ts` (lines 210-254):
- Pipeline failure caught via `Effect.either`
- `markTaskExhaustedFailure` called with reason, engine, workerId, and timestamps
- `setEpicRuntimeStatus(epicId, "error")` called for runtime state
- `addLabel(epicId, "error")` called for operator visibility
- `addComment(issueId, ...)` called for diagnostic thread comment
- All label/state writes are best-effort (caught errors logged, not propagated)

### AC4: Regression coverage for observer comment behavior, status mapping, and startup recovery

**PASS** — Verified in `retryErrorContract.test.ts`, Contract 4 (10 tests):

**Observer comment behavior (3 tests):**
- Successful execution writes session comment with resume token (`--resume`)
- Successful execution writes success comment with `"all checks passed"`
- Comments include attempt number formatting `[attempt N/M]`

**Status mapping semantics (5 tests):**
- Runtime `error` takes highest priority in `deriveEpicDisplayStatus`
- `ready` + `clean` worktree → `active`
- `ready` + `dirty` worktree → `dirty`
- `no_attempt` + no worktree → `not_started`
- Error → ready transition after successful workspace-prepare (runtime state changes from `"error"` to `"ready"`, error label removed)

**Startup recovery behavior (3 tests):**
- `markTaskExhaustedFailure` preserves error reason and timing metadata for later retry
- Failed task does NOT close the task (no `closeTaskSuccess` or `closeTaskFailure` call)
- Failed task result carries engine and error for diagnostic visibility

## Implementation Architecture Verification

### Blueprints workspace primitives (tracker-agnostic)
- `workspace-prepare.ts`: Three hard-gated stages (ensure → copy-ignored → bootstrap)
- `copy.ts`: Git-ignored discovery with `.worktreeinclude` narrowing support
- `bootstrap.ts`: Lockfile-aware package manager detection (pnpm, bun, yarn, npm)
- `workspace.ts`: Worktree create/reuse/recreate lifecycle

### Ralphe integration (tracker-aware)
- `watchWorkflow.ts`: Integrates blueprints `workspacePrepare` pipeline via dependency injection
- `BeadsRunObserver.ts`: Owns lifecycle comments/metadata writes
- `epicRuntimeState.ts`: Epic runtime status tracking (no_attempt, ready, error)
- `beads.ts`: Owns `markTaskExhaustedFailure`, `readMetadata`, label/comment operations

### Separation of concerns
- Blueprints: no Beads, no epic, no tracker imports — purely workspace lifecycle
- Ralphe: owns epic context, Beads metadata/comments/labels, retry prompt assembly, TUI status derivation

## Conclusion

All 163 tests pass across 6 test files. The four acceptance criteria are fully met with explicit regression coverage. The retry/error contract is preserved: retries consume only last structured metadata failure, comments remain history-only, workspace-prepare failures flow through the existing exhausted-failure/error path, and observer/status/recovery behaviors are protected by regression tests.
