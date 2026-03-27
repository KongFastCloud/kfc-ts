# Verification Report: Workspace Lifecycle Primitives in Blueprints

**Date:** 2026-03-27
**Task:** Blueprints: extract generic workspace lifecycle primitives
**Parent Epic:** kfc-ts-pe20

## Summary

**Result: PASS** — All acceptance criteria verified.

## Acceptance Criteria Verification

### 1. Blueprints exposes reusable primitives for ensure/recreate/remove workspace worktree lifecycle operations

**Status: PASS**

`packages/blueprints/src/workspace.ts` implements all required primitives:
- `ensureWorktree(path, branch, sourceCwd?)` — lazy create/reuse/recreate with branch matching
- `createWorktree(path, branch, sourceCwd?)` — creates new worktree with parent dir setup and stale prune
- `removeWorktree(path, sourceCwd?)` — force-removes worktree and prunes references
- `recreateWorktree(path, branch, sourceCwd?)` — remove + create on different branch
- `removeWorktreeWithCleanup(path, sourceCwd?)` — remove with dirty-state metadata

Supporting primitives also exposed:
- `sanitizeWorkspaceId(id)` — safe directory name derivation
- `getRepoRoot(cwd?)` — git repo root detection
- `worktreeExistsAt(path)` — synchronous worktree linkage check
- `getWorktreeBranch(path)` — branch detection
- `getWorktreeState(path)` — tri-state detection (not_found/clean/dirty)
- `isWorktreeDirty(path)` / `isWorkspaceDirty(path)` — dirty check

All exported from `packages/blueprints/src/index.ts` (lines 93-106).

### 2. Primitives are tracker-agnostic and do not encode epic/task/Beads semantics

**Status: PASS**

- `workspace.ts` has zero imports from any tracker, Beads, epic, or task module.
- All functions accept explicit paths and branch names — no domain context resolution.
- File header documents this invariant explicitly: "No runtime state, labels, comments, or tracker writes happen here."
- Error type is generic `FatalError` with command/message shape, not domain-specific.

### 3. Existing ralphe lifecycle call sites compile against the new API boundary via adapters

**Status: PASS**

- `apps/ralphe/src/epicWorktree.ts` imports from `@workspace/blueprints` (line 31)
- Delegates to blueprints primitives: `sanitizeWorkspaceId`, `getRepoRoot`, `ensureWorktree`, `getWorktreeState`, `isWorkspaceDirty`, `removeWorktreeWithCleanup`, `worktreeExistsAt`
- Ralphe provides epic-specific adapters: `ensureEpicWorktree`, `getEpicWorktreeState`, `isEpicWorktreeDirty`, `removeEpicWorktree`
- All exports from `apps/ralphe/src/index.ts` (lines 48-53) confirm public API surface
- TypeScript compilation passes with zero errors for both packages

### 4. Behavior parity is preserved for baseline ensure/recreate/remove flows

**Status: PASS**

- `ensureWorktree` implements the three-way lifecycle: reuse (branch match), recreate (branch mismatch), create (missing)
- `removeWorktree` uses `--force` flag for dirty worktree handling
- `removeWorktreeWithCleanup` reports dirty state metadata before removal
- `createWorktree` handles branch creation from HEAD when local branch doesn't exist

## Test Results

| Test Suite | Tests | Status |
|---|---|---|
| `packages/blueprints/tests/workspace.test.ts` | 23 pass, 0 fail | PASS |
| `packages/blueprints/tests/workspace-contract.test.ts` | 7 pass, 0 fail | PASS |
| `packages/blueprints/tests/workspace-cwd.test.ts` | 3 pass, 0 fail | PASS |

**TypeScript Compilation:**
- `packages/blueprints` — clean (0 errors)
- `apps/ralphe` — clean (0 errors)

## Architecture Assessment

The separation of concerns is correct:
- **Blueprints** owns git/filesystem mechanics (tracker-agnostic)
- **Ralphe** owns epic identity mapping, domain context, and policy
- Effect-based error handling throughout with `FatalError` tagged type
- Explicit inputs/outputs, no hidden state or defaults
