# Verification Report: Epic Branch Ownership and Lazy Worktree Lifecycle

**Date:** 2026-03-26
**Status:** PASS

## Summary

All acceptance criteria for epic branch ownership and lazy worktree lifecycle have been correctly implemented and verified through code review and test execution.

## Test Results

- **epic.test.ts**: 30 tests pass (0 failures) — 69 expect() calls
- **epicWorktree.test.ts**: Part of the above 30 tests — sanitization and path determinism
- **watchWorkflow.test.ts**: 37 tests pass (0 failures) — 149 expect() calls

Total: **67 tests, 0 failures**

## Acceptance Criteria Verification

### 1. Each epic owns exactly one canonical branch stored as epic metadata
**PASS**
- `EpicContext` interface in `src/epic.ts` includes `readonly branch: string`
- `WatchTask` in `src/beadsAdapter.ts` (line 81) includes `readonly branch?: string | undefined`
- Branch is loaded from `metadata.ralphe.branch` via `normalizeRalpheMeta()`
- Validation in `validateEpicContext()` requires non-empty, trimmed branch (lines 87-89)
- Error `EPIC_ERROR_MISSING_BRANCH` is raised for epics without a branch
- Tests verify: empty branch, undefined branch, whitespace-only branch all rejected; valid branch accepted and trimmed

### 2. Worktree paths are derived under one fixed global ralphe worktree root
**PASS**
- `WORKTREE_DIR_NAME = ".ralphe-worktrees"` is hardcoded (not configurable) in `src/epicWorktree.ts` (line 31)
- `getWorktreeRoot()` returns `{repo_root}/.ralphe-worktrees` (line 100-103)
- `deriveEpicWorktreePath(epicId)` returns `{worktreeRoot}/{sanitizedEpicId}` (lines 111-114)
- `sanitizeEpicId()` prevents path traversal and filesystem issues (line 87-88)
- Tests verify sanitization: slashes → underscores, special chars → underscores, alphanumeric/dash/dot/underscore preserved

### 3. The first runnable child task under an epic lazily creates the epic worktree when missing
**PASS**
- `ensureEpicWorktree(epic)` in `src/epicWorktree.ts` (lines 196-223):
  - Checks if worktree exists at derived path via `worktreeExistsAt()`
  - If missing: calls `createWorktree()` which ensures parent dir, prunes stale refs, runs `git worktree add`
- `processClaimedTask()` in `src/watchWorkflow.ts` calls `deps.ensureEpicWorktree(epicContext)` before execution
- Test "ensureEpicWorktree is called with the epic context" verifies the call with correct epic ID and branch

### 4. Later tasks under the same epic reuse the same worktree and branch
**PASS**
- `ensureEpicWorktree()` returns existing worktree path when worktree exists and is on correct branch (line 206-208)
- Test "multiple tasks under same epic reuse the worktree" runs two tasks under "reuse-epic" and verifies both calls use the same epic ID/branch, both get the same worktree path

### 5. Tasks do not create per-task branches or per-task worktrees
**PASS**
- No per-task branch creation logic exists in the codebase (grep confirmed zero matches)
- `ensureEpicWorktree` operates at epic level only, keyed by `epic.id` and `epic.branch`
- `processClaimedTask()` uses the epic worktree path directly as execution `cwd`
- Test "worktree path is set on the RunRequest (cwd)" confirms worktree path flows through to execution

### 6. Missing epic worktrees can be recreated from canonical epic context when needed
**PASS**
- `ensureEpicWorktree()` handles three cases:
  1. Worktree exists, correct branch → reuse (line 206-208)
  2. Worktree exists, wrong branch → `recreateWorktree()` removes and recreates (line 212)
  3. Worktree missing → `createWorktree()` creates fresh (line 218)
- `recreateWorktree()` uses `git worktree remove --force`, prunes, then recreates (lines 146-158)
- Only `EpicContext` (id + branch) is needed for recreation — no additional state required

## Architecture Notes

- **epicWorktree.ts**: Pure worktree lifecycle module — path derivation, creation, reuse, recreation
- **epic.ts**: Epic domain model — EpicContext type, validation, loading, preamble building
- **watchWorkflow.ts**: Orchestration — loads epic context, ensures worktree, passes cwd to execution
- **beadsAdapter.ts**: Metadata bridge — reads `branch` from `metadata.ralphe.branch`
- Cross-epic isolation is materially real: different epics get different worktree directories under the shared root
- The `ensureEpicWorktree` dependency is injectable for testability

## Files Reviewed

| File | Purpose |
|------|---------|
| `apps/ralphe/src/epicWorktree.ts` | Worktree lifecycle (224 lines) |
| `apps/ralphe/src/epic.ts` | Epic domain model (166 lines) |
| `apps/ralphe/src/watchWorkflow.ts` | Task processing orchestration |
| `apps/ralphe/src/beadsAdapter.ts` | Branch metadata in WatchTask |
| `apps/ralphe/tests/epicWorktree.test.ts` | Sanitization and path tests |
| `apps/ralphe/tests/epic.test.ts` | Validation and loading tests |
| `apps/ralphe/tests/watchWorkflow.test.ts` | Full workflow integration tests |
