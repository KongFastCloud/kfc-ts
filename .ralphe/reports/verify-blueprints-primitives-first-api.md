# Verification Report: Establish blueprints as primitives-first API

**Date:** 2026-03-24
**Status:** PASS

## Summary

The @workspace/blueprints package has been correctly refactored to serve as a primitives-first execution toolkit. The implementation satisfies all four acceptance criteria.

## Acceptance Criteria Verification

### 1. Supported blueprints public surface is explicit ✅

The `src/index.ts` file has a comprehensive JSDoc header documenting:
- What blueprints owns (Engine, retry loop, execution steps, git primitives, error types)
- What apps own (workflow assembly, lifecycle observers, prompt policy, tracker integration, tracing)

Exports are organized into clearly labeled sections:
- Engine interface (`Engine`, `AgentResult`)
- Error types (`CheckFailure`, `FatalError`)
- Loop primitive (`loop`, `LoopEvent`, `LoopEventType`, `LoopOptions`)
- Execution steps (`agent`, `cmd`, `report` with associated types)
- Git primitives (`gitCommit`, `gitPush`, `gitWaitForCi`, `isWorktreeDirty`)
- Git composition helpers (`buildCiGitStep`, `executePostLoopGitOps`, `defaultGitOps`)

The README.md provides a full package ownership matrix, quick start example, and primitives reference.

### 2. Both ralphe and ralphly can consume primitives without new shared orchestration ✅

- **ralphly** actively imports from @workspace/blueprints: `Engine`, `AgentResult`, `CheckFailure`, `FatalError`, `LoopEvent`, `RunConfig`, `RunResult`, `run()`. It provides its own `ClaudeEngineLayer` implementation and owns its own workflow assembly (worker loop, Linear integration, session activities).
- **ralphe** has its own execution pipeline and can consume the same primitives. The PRD documents the planned migration path.
- All primitives accept explicit `workspace` parameter — no hidden process.cwd() dependency.

### 3. No new shared runner-like abstraction introduced ✅

Searched for `runChecks`, `runGitFlow`, and `orchestrat` patterns in the source. No new orchestration helpers exist. The only orchestrator is the deprecated `run()` in `runner.ts`, which is clearly marked:
- File-level JSDoc: `@deprecated Use primitives-based workflow assembly`
- Export-level JSDoc: `@deprecated Use primitives-based workflow assembly instead.`
- Separate section in index.ts labeled "Transitional: shared runner"

### 4. Temporary coexistence with old runner is clearly transitional ✅

The `runner.ts` module header explicitly states:
> "This module provides the legacy `run()` orchestrator... It exists for backward compatibility while ralphly migrates to primitives-based composition. New code should NOT depend on `run()`."

The README states:
> "The runner will be removed once all consumers have migrated to local workflow assembly."

All runner exports are marked `@deprecated`.

## Test Results

| Package | Tests | Pass | Fail |
|---------|-------|------|------|
| packages/blueprints | 53 | 53 | 0 |
| apps/ralphly | 255 | 255 | 0 |
| apps/ralphe | 653 | 653 | 0 |

All 961 tests pass across all three packages.

## Key Design Decisions Verified

- **Workspace threading**: All primitives take explicit `workspace` parameter; dedicated `workspace-cwd.test.ts` proves no process.cwd() fallback
- **Effect-based**: All operations use the Effect library for typed error handling and composition
- **Pluggable Engine**: Callers provide Engine via Effect's Layer system; blueprints is backend-agnostic
- **Tracing-unaware**: No tracing or telemetry in the package
- **Dependency injection**: GitOps injectable for testing without module mocking
