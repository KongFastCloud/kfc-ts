# Verification: Agent and Check Execution Honor Configured Workspace

**Date:** 2026-03-24
**Status:** PASS

## Summary

Verified that both agent execution and check (shell command) execution use the explicitly configured workspace path instead of `process.cwd()`.

## Acceptance Criteria Verification

### 1. Agent step uses configured workspace instead of launch cwd — PASS

- `packages/blueprints/src/agent.ts`: The `agent()` function accepts an explicit `workspace` parameter and passes it directly to `engine.execute(prompt, workspace)`. No fallback to `process.cwd()`.
- Test coverage in `workspace-cwd.test.ts`: "engine receives workspace, not process.cwd()" — creates a temp directory that differs from `process.cwd()`, invokes agent with it, and asserts `receivedWorkDir === workspace && receivedWorkDir !== launchDir`.

### 2. Check commands run in configured workspace instead of launch cwd — PASS

- `packages/blueprints/src/cmd.ts`: The `cmd()` function accepts an explicit `workspace` parameter and uses `Bun.spawn(["sh", "-c", command], { cwd: workspace })`. No fallback to `process.cwd()`.
- Test coverage in `workspace-cwd.test.ts`:
  - "pwd returns workspace, not process.cwd()" — runs `pwd` in the workspace and asserts it matches.
  - "file created by check lands in workspace, not launch dir" — runs `touch` in workspace, confirms file exists there and NOT in launch dir.

### 3. Files created in correct directory (bug resolved) — PASS

- The `workspace-cwd.test.ts` test "check output proves execution in workspace, not launch dir" runs a full pipeline (agent + check `echo workspace-proof > marker.txt`) and verifies the marker file exists in the workspace directory, not the launch directory.

### 4. Tests launch from different directory than target workspace — PASS

- All workspace-cwd tests explicitly create a temp directory that differs from `process.cwd()` and include a guard: `if (workspace === launchDir) throw new Error(...)`.
- Every assertion includes both `expect(dir).toBe(workspace)` AND `expect(dir).not.toBe(launchDir)`.

## Additional Verification

### No process.cwd() in execution paths

Grepped `packages/blueprints/src/` for `process.cwd()` — only found in comments (documentation), not in executable code. The execution surfaces (agent.ts, cmd.ts, runner.ts, report.ts, git.ts) all thread the explicit workspace parameter.

### Full pipeline propagation

The runner (`runner.ts`) threads workspace through all stages:
- `agent(task, workspace)` — agent execution
- `cmd(check, workspace)` — each check command
- `report(task, workspace, mode)` — verification step
- `gitCommit(workspace)`, `gitPush(workspace)` — git operations

### Test Results

- **blueprints package:** 53 tests, 0 failures, 102 expect() calls
- **ralphly app:** 245 tests, 0 failures, 595 expect() calls
- All workspace-cwd contract tests pass

## Conclusion

The implementation correctly ensures that both agent execution and check commands run in the configured workspace rather than the CLI launch directory. The fix is end-to-end across all execution surfaces in the blueprints runner, and the behavior is proven by tests that explicitly launch from a different directory than the target workspace.
