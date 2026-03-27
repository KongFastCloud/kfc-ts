# Verification: Blueprints Workspace-Prepare Pipeline Integration into Ralphe Watch Workflow

**Date:** 2026-03-27
**Task:** kfc-ts-pe20 — Move worktree bootstrap primitives into blueprints with copy-ignored default
**Status:** PASS

## Acceptance Criteria Verification

### 1. Ralphe watch workflow invokes blueprints workspace-prepare pipeline before execution attempts — PASS

**Evidence:**
- `apps/ralphe/src/watchWorkflow.ts` imports `workspacePrepare` from `@workspace/blueprints` (line 43)
- `processClaimedTask` calls `deps.workspacePrepare()` at lines 205-208 when runtime status is not "ready"
- The pipeline is invoked with explicit inputs: `worktreePath`, `branch`, `sourceWorkspace`
- The call happens **before** request assembly and task execution (lines 320+)
- `workspacePrepare` is injectable via `WatchWorkflowDeps` for testability (line 97)

### 2. App-layer ownership remains intact — PASS

**Evidence:**
- Beads labels/comments/metadata writes remain in `watchWorkflow.ts` (addLabel, addComment, writeMetadata, markTaskExhaustedFailure)
- Epic context resolution remains in `apps/ralphe/src/epic.ts`
- Epic runtime state tracking remains in `apps/ralphe/src/epicRuntimeState.ts`
- TUI status derivation remains in ralphe (epicRuntimeState)
- `packages/blueprints/src/workspace-prepare.ts` contains zero tracker/Beads/epic semantics — confirmed by code review

### 3. Workspace-prepare failures propagate through existing exhausted-failure path — PASS

**Evidence:**
- Lines 211-255 in `watchWorkflow.ts`: when `workspacePrepare` returns `Left` (failure):
  - Epic runtime status set to "error" (line 215)
  - Error label added to epic (line 221)
  - Failure comment added to task (line 227)
  - Task marked as exhausted failure via `markTaskExhaustedFailure` (line 238)
  - `ProcessTaskResult` returned with `success: false` and error reason
- This matches the existing exhausted-failure flow used for other task failures

### 4. No new app-local duplicate workspace bootstrap logic remains on critical path — PASS

**Evidence:**
- No `pnpm install`, `bun install`, `npm ci`, or `yarn install` commands found in `apps/ralphe/src/`
- `apps/ralphe/src/epicBootstrap.ts` exists as a thin adapter delegating to blueprints `bootstrapInstall`
- `apps/ralphe/src/epicWorktree.ts` delegates worktree mechanics to blueprints primitives
- The watch workflow's critical path uses only `deps.workspacePrepare()` (blueprints) or `deps.ensureEpicWorktree()` (thin adapter)

## Blueprints Pipeline Architecture

The `workspacePrepare` pipeline in `packages/blueprints/src/workspace-prepare.ts` implements three hard-gated stages:

1. **Ensure worktree** — create/reuse/recreate via `ensureWorktree()`
2. **Copy ignored** — git-ignored artifact copy with `.worktreeinclude` support via `copyIgnored()`
3. **Bootstrap install** — lockfile-aware dependency install via `bootstrapInstall()`

All stages are Effect-native, tracker-agnostic, and accept explicit inputs (no `process.cwd()` defaults).

## Test Results

### Blueprints tests
- `workspace-prepare.test.ts`: **8 pass, 0 fail** (24 assertions)
- `workspace.test.ts` + `bootstrap.test.ts` + `copy.test.ts`: **66 pass, 0 fail** (85 assertions)

### Ralphe tests
- `watchWorkflow.test.ts`: **53 pass, 0 fail** (203 assertions)
  - Covers: workspace-prepare integration, failure propagation, runtime status transitions, retry semantics, epic context validation

### Typecheck
- `@workspace/blueprints`: PASS (cache hit)
- `ralphe`: PASS (cache hit)

## Design Alignment

| Concern | Owner | Verified |
|---------|-------|----------|
| Workspace lifecycle primitives | blueprints | Yes |
| Copy-ignored + .worktreeinclude | blueprints | Yes |
| Bootstrap install (lockfile-aware) | blueprints | Yes |
| Workspace-prepare pipeline | blueprints | Yes |
| Epic context resolution | ralphe | Yes |
| Beads labels/comments/metadata | ralphe | Yes |
| Epic runtime state + TUI derivation | ralphe | Yes |
| Retry prompt assembly (metadata only) | ralphe | Yes |

## Conclusion

All four acceptance criteria are met. The blueprints workspace-prepare pipeline is correctly integrated into ralphe's watch workflow. Ownership boundaries are clean — blueprints owns reusable primitives, ralphe owns tracker policy and lifecycle semantics. All tests pass with comprehensive coverage of the integration points.
