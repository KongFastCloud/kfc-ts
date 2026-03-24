# Verification Report: Thread Explicit Workspace Through Blueprints Runner Contract

**Date:** 2026-03-24
**Status:** PASS

## Summary

The explicit workspace contract has been correctly implemented in the blueprints runner and threaded through all execution surfaces.

## Acceptance Criteria Verification

### 1. Blueprints exposes an explicit workspace contract rather than relying on ambient cwd — PASS

- `RunnerOptions` interface in `packages/blueprints/src/runner.ts` (line 167) has an explicit `readonly workspace: string` field
- JSDoc clearly states: "the runner never falls back to process.cwd()"
- `process.cwd()` does NOT appear in any executable code within the blueprints package (only in documentation comments)
- All execution steps receive workspace explicitly:
  - `agent(task, workspace, opts?)` — passes workspace to `engine.execute(prompt, workspace)`
  - `cmd(command, workspace)` — uses workspace as `cwd` for `Bun.spawn()`
  - `report(task, workspace, mode, options?)` — resolves report directory relative to workspace
  - `gitCommit(workspace)`, `gitPush(workspace)`, `gitWaitForCi(workspace)` — all use workspace as `cwd`

### 2. The runner interface is shaped so callers can provide the execution workspace directly — PASS

- `RunnerOptions.workspace` is a required `string` field — callers must provide it
- `GitOps` interface methods all accept `workspace: string` parameter
- Ralphly (the primary caller) threads workspace from config through worker → runIssue → blueprints.run()
- `RunIssueOptions` and `WorkerOptions` both have explicit `workspace: string` fields

### 3. The contract remains tracker-agnostic and suitable for future worktree-prepared paths — PASS

- `RunnerOptions` has no tracker-specific fields (onEvent and onAgentResult are generic callbacks)
- JSDoc on workspace field explicitly states: "Callers provide the repo root, worktree path, or any target directory"
- The workspace is a plain string path — works equally for repo roots, worktree paths, or any directory
- No worktree management logic exists in blueprints

### 4. The slice does not implement worktree provisioning — PASS

- No worktree creation/management code exists in the blueprints package
- `isWorktreeDirty()` is a read-only git check, not provisioning
- The workspace is purely an input — blueprints never creates or manages workspaces

## Test Results

### Blueprints Tests
- **29 tests pass, 0 failures** across 5 test files
- `cmd.test.ts` explicitly verifies command execution happens in the specified workspace directory (using `pwd`)
- `runner.test.ts` uses `testWorkspace = fs.realpathSync(os.tmpdir())` and threads it through all tests

### Ralphly Tests
- **245 tests pass, 0 failures** across 11 test files
- `acceptance.test.ts` verifies workspace propagation through the full stack
- `runner.test.ts` tests pass workspace: `"/tmp/test-workspace"` to runIssue
- `config.test.ts` tests `workspacePath` configuration loading with backward compatibility
- `setup-path.test.ts` tests end-to-end workspace path configuration precedence

## Naming Consistency

| Layer | Field Name | Status |
|-------|-----------|--------|
| Blueprints RunnerOptions | `workspace` | Correct |
| Blueprints step functions | `workspace` parameter | Correct |
| Engine interface | `workDir` parameter | Consistent |
| Ralphly config | `workspacePath` | Correct |
| Ralphly env var | `RALPHLY_WORKSPACE_PATH` | Correct |
| Ralphly RunIssueOptions | `workspace` | Correct |
| Ralphly WorkerOptions | `workspace` | Correct |

## Backward Compatibility

- `RALPHLY_REPO_PATH` env var falls back correctly to `RALPHLY_WORKSPACE_PATH`
- `repoPath` config field falls back correctly to `workspacePath`
- Tested in `config.test.ts`
