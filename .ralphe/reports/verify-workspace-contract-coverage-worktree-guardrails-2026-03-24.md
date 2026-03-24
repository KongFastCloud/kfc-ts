# Verification: Workspace-Contract Coverage and Future-Worktree Guardrails

**Date:** 2026-03-24
**Status:** PASS

## Summary

Verified that the workspace-contract coverage and future-worktree guardrails slice was correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. Tests prove cwd-independence across the explicit workspace contract ✅

Three test suites validate cwd-independence:

- **`packages/blueprints/tests/workspace-cwd.test.ts`** (2 tests) — Acceptance tests proving `agent()` and `cmd()` execute in the configured workspace, not `process.cwd()`. Creates a temp workspace guaranteed to differ from launch dir, then asserts both engine `workDir` and `pwd` output match workspace.

- **`packages/blueprints/tests/workspace-contract.test.ts`** (8 tests) — Full primitives surface coverage:
  - Report step creates directories inside workspace
  - Engine receives workspace (not cwd) for report execution
  - `buildCiGitStep` passes workspace to commit, push, and waitCi callbacks
  - `executePostLoopGitOps` threads workspace to commit and push
  - `executePostLoopGitOps` "none" mode does not invoke any ops
  - Multi-step pipeline (agent → cmd → report) receives same workspace at every step
  - Deeply nested worktree-like paths work as valid workspaces

- **`apps/ralphly/tests/workspace-propagation.test.ts`** (10 tests) — End-to-end workspace propagation from config loading through `runIssue` to every primitive.

**Test execution results:** All 20 tests across 3 files pass (0 failures).

### 2. Tests cover the naming/config transition and effective workspace reporting ✅

The `workspace-propagation.test.ts` suite explicitly tests:

- `workspacePath` loaded from config file differs from both `configDir` and `launchDir`
- `RALPHLY_WORKSPACE_PATH` env var overrides config file `workspacePath`
- Deprecated `repoPath` config key flows through as `workspacePath` with deprecation warning
- New `workspacePath` takes precedence over deprecated `repoPath` when both present
- Deprecation warnings contain "deprecated" text for operator visibility

The `config.ts` implementation:
- Primary names: `RALPHLY_WORKSPACE_PATH` (env), `workspacePath` (config)
- Backward-compat aliases: `RALPHLY_REPO_PATH` (env), `repoPath` (config)
- Clear deprecation messages guide operators to migrate

### 3. Docs explain the explicit workspace contract (valid for future worktree support) ✅

`packages/blueprints/README.md` lines 202-294 contain comprehensive documentation:
- **Workspace contract** section with the hard invariant statement
- **Why not process.cwd()** explanation of the bug class eliminated
- **What "workspace" means** — execution root for agent, checks, reports, git
- **Workspace is opaque** — valid for repo root, subdirectory, or future worktree
- **Future worktree readiness** with ASCII diagram of abstraction boundary
- **Threading workspace through a workflow** with example code
- **Test coverage** section pointing to both primitives and app-level tests

### 4. The slice prepares for worktrees without implementing them ✅

Evidence:
- No worktree creation, cleanup, or lifecycle code exists in the codebase
- The abstraction boundary is correct: caller provides workspace path, blueprints executes inside it
- Tests include worktree-like paths (deeply nested temp dirs simulating `/tmp/.../worktrees/ENG-42/`) to prove the contract works for any path
- Documentation explicitly describes the future worktree layer as a caller-side concern that requires no blueprints changes
- `workspace` parameter is opaque — primitives don't inspect or assume anything about the path

## Source Code Verification

Key source files confirmed workspace-aware (no `process.cwd()` fallback):
- `packages/blueprints/src/agent.ts` — `workspace` param threaded to `engine.execute(prompt, workspace)`
- `packages/blueprints/src/cmd.ts` — `Bun.spawn` uses `cwd: workspace`
- `packages/blueprints/src/report.ts` — creates dirs relative to workspace, passes to engine
- `packages/blueprints/src/git-steps.ts` — `buildCiGitStep` and `executePostLoopGitOps` thread workspace to all GitOps callbacks
- `apps/ralphly/src/config.ts` — loads `workspacePath` with env override and backward-compat aliases
- `apps/ralphly/src/runner.ts` — `RunIssueOptions.workspace` threaded to every primitive

## Test Execution

```
# Blueprints workspace tests
10 pass, 0 fail, 27 expect() calls (145ms)

# Ralphly workspace propagation tests
10 pass, 0 fail, 34 expect() calls (151ms)
```

## Conclusion

All four acceptance criteria are satisfied. The implementation correctly establishes an explicit workspace contract across the entire stack, with comprehensive test coverage at both the primitives and app levels. The naming/config transition is handled with backward compatibility and deprecation warnings. Documentation is thorough and remains valid for future worktree support. No worktree provisioning or lifecycle management was implemented — the slice stays within scope.
