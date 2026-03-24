# Verification: ralphly passes and displays effective workspace

**Date**: 2026-03-24
**Task**: Update ralphly to pass and display the effective workspace
**Result**: PASS

## Acceptance Criteria Verification

### 1. ralphly passes the configured workspace into blueprints
**PASS**

- `src/config.ts`: `loadConfig()` resolves `workspacePath` from `RALPHLY_WORKSPACE_PATH` env var or `workspacePath` config key (with backward compat for `RALPHLY_REPO_PATH` / `repoPath`)
- `cli.ts` line 148-153: `runWorkerLoop()` receives `workspace: cfg.workspacePath`
- `src/worker.ts`: `WorkerOptions` interface has explicit `workspace: string` field; `runWorkerIteration()` passes `workspace: opts.workspace` to `runIssue()` (lines 227, 268)
- `src/runner.ts`: `RunIssueOptions` has explicit `workspace: string` field; `runIssue()` passes `workspace` directly to `blueprintsRun()` (line 193-203)
- `packages/blueprints/src/runner.ts`: `RunnerOptions` has explicit `workspace: string` field with clear docstring; `run()` threads workspace to `agent()`, `cmd()`, `report()`, and all git operations

The entire chain is: config → CLI → workerLoop → runIssue → blueprints.run → {agent, cmd, report, git} — all with explicit workspace parameter.

### 2. CLI/operator output clearly shows the effective target workspace
**PASS**

- `ralphly config` output shows `Workspace: <path>` with source annotation (line 206-207)
- `ralphly run` startup shows `Workspace: <path>` in Configuration section (line 75)
- `ralphly run` shows `Targeting workspace: <path>` in Worker Run section (line 137)
- `ralphly run --dry-run` shows `in workspace: <path>` for the issue that would be processed (line 126)
- Deprecation warnings are displayed when old naming is used (lines 78-80)

### 3. Running ralphly from another directory still targets the configured workspace correctly
**PASS**

- Config tests in `tests/config.test.ts` (lines 236-271): "workspace is independent of launch directory" test suite:
  - `configured workspace path is used regardless of workDir` — verifies `workspacePath !== TEST_DIR`
  - `env-var workspace works without any config file` — loads from empty dir with env vars
- Blueprints contract tests in `packages/blueprints/tests/workspace-cwd.test.ts`:
  - Creates a temp workspace that differs from `process.cwd()`
  - Verifies engine receives workspace, not `process.cwd()`
  - Verifies `pwd` check command returns workspace, not launch dir
  - Verifies files created by checks land in workspace
  - Full pipeline test: agent + checks both receive workspace end-to-end
- `cmd.ts` spawns processes with `cwd: workspace` (not process.cwd())
- `agent.ts` passes workspace to `engine.execute(prompt, workspace)`

### 4. Operator-facing naming is consistent with new workspace terminology
**PASS**

- Config interface uses `workspacePath` (not `repoPath`)
- CLI output uses "Workspace" label consistently
- Worker output uses "Targeting workspace"
- Dry-run output uses "in workspace"
- Environment variable is `RALPHLY_WORKSPACE_PATH`
- Backward compat: old names (`repoPath`, `RALPHLY_REPO_PATH`) emit deprecation warnings guiding to new names
- All deprecation warning tests pass (7 tests in backward compatibility suite)

## Test Results

- **blueprints**: 53 tests pass, 0 fail (across 8 files)
- **ralphly**: 255 tests pass, 0 fail (across 11 files)

Key test files covering this feature:
- `apps/ralphly/tests/config.test.ts` — workspace config loading, env override, backward compat, deprecation warnings, launch-dir independence
- `apps/ralphly/tests/runner.test.ts` — workspace passed through to blueprints
- `apps/ralphly/tests/worker.test.ts` — workspace threaded through worker loop
- `packages/blueprints/tests/workspace-cwd.test.ts` — contract tests proving workspace ≠ process.cwd()

## Summary

The implementation correctly:
1. Loads workspace config with new naming (`workspacePath` / `RALPHLY_WORKSPACE_PATH`) and backward compat
2. Threads explicit workspace through the full execution chain (CLI → worker → runner → blueprints → agent/cmd/report/git)
3. Displays the effective workspace prominently in all operator surfaces (config, run, dry-run)
4. Uses consistent "workspace" terminology throughout, with deprecation warnings for old naming
5. Never falls back to `process.cwd()` — the configured workspace is always used explicitly
