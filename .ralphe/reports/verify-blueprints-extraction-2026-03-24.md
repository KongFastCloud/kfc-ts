# Verification Report: Extract blueprints execution runner from ralphe loop

**Date:** 2026-03-24
**Status:** PASS

## Summary

The blueprints package has been correctly implemented as a shared execution runner extracted from ralphe's loop semantics.

## Acceptance Criteria Verification

### 1. A new shared blueprints package exists in the workspace
**PASS** - `packages/blueprints/` exists with `package.json` (name: `@workspace/blueprints`), proper ESM module config, and is included in the pnpm workspace via `packages/*` glob.

### 2. Blueprints exposes a reusable execution runner aligned with current ralphe loop semantics
**PASS** - The package exports:
- `run()` - canonical execution runner composing agent -> checks -> report -> git with retry loop
- `loop()` - generic retry loop with feedback propagation (semantically identical to ralphe's loop)
- `Engine` - abstract interface for pluggable execution backends
- `agent()`, `cmd()`, `report()` - individual pipeline steps
- `gitCommit()`, `gitPush()`, `gitWaitForCi()` - git operations
- `buildCiGitStep()`, `executePostLoopGitOps()` - git orchestration helpers

Key semantics preserved from ralphe:
- Caller provides prepared task input (no prompt construction inside blueprints)
- Feedback propagation on failure (CheckFailure stderr -> next attempt feedback)
- Lifecycle events via `onEvent` callback (attempt_start, check_failed, success)
- Resume token tracking via `onAgentResult` callback
- Structured `RunResult` with success/error/resumeToken/attempts
- Git mode support: none, commit, commit_and_push, commit_and_push_and_wait_ci

### 3. Blueprints owns retries, feedback propagation, and execution orchestration without depending on Linear or Beads
**PASS** - Dependencies are minimal:
- Only runtime dependency: `effect` (Effect runtime)
- No imports from Linear, Beads, or any tracker-specific code
- No HTTP/webhook infrastructure
- Engine interface is abstract (Context tag) - callers inject their own implementation

### 4. Ralphe remains unchanged in behavior and does not depend on blueprints yet
**PASS** - Verified:
- `grep` for `blueprints` or `@workspace/blueprints` in `apps/ralphe/` returns zero results
- Ralphe's `package.json` has no dependency on blueprints
- Ralphe maintains its own copies of loop, agent, cmd, report, git, errors
- All 533 ralphe tests pass (0 failures)

### 5. The blueprints API is shaped so a later ralphe migration is plausible without redesigning the runner
**PASS** - The API design supports ralphe migration:
- `RunnerOptions.engineLayer` accepts any Effect Layer implementing Engine (ralphe has ClaudeEngine, CodexEngine)
- `RunnerOptions.onEvent` allows ralphe to inject Beads comment logic without blueprints knowing about Beads
- `RunnerOptions.onAgentResult` allows session tracking for Beads metadata
- `RunConfig` maps directly to ralphe's config structure (maxAttempts, checks, gitMode, report)
- `GitOps` interface allows dependency injection for testing
- `RunResult` provides the same fields ralphe's `TaskResult` needs (success, resumeToken, error, attempts)

## Test Results

### Blueprints tests: 28 pass, 0 fail
- `loop.test.ts` - 9 tests (retry behavior, feedback propagation, event emissions)
- `runner.test.ts` - 13 tests (full pipeline, shared orchestration)
- `engine.test.ts` - 2 tests (Engine context injection)
- `errors.test.ts` - 2 tests (error tagging)
- `cmd.test.ts` - 2 tests (command execution)

### Ralphe tests: 533 pass, 0 fail
Confirms ralphe behavior is unchanged.

### Type checking: PASS
`tsc --noEmit` completes with zero errors.

## Non-goals confirmed
- Ralphe is NOT migrated to use blueprints (confirmed: no imports)
- No Linear-specific prompt construction in blueprints
- No HTTP/webhook infrastructure in blueprints
