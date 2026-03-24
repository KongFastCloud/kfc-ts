# Verification Report: Rewrite ralphe direct run around RunRequest and RunObserver

**Date:** 2026-03-24
**Status:** PASS

## Summary

The ralphe direct run path has been successfully rewritten around `RunRequest` and `RunObserver` abstractions. All acceptance criteria are met.

## Acceptance Criteria Verification

### 1. App-owned workflow builder from blueprints primitives
**Status: PASS**

- `buildRunWorkflow()` in `src/buildRunWorkflow.ts` is the single place where direct-run step ordering is defined.
- It composes blueprints primitives explicitly: `agent()`, `cmd()`, `loop()`, `report()`, and git workflow helpers (`buildCiGitStep`, `executePostLoopGitOps`).
- The CLI (`cli.ts` run subcommand) calls `buildRunWorkflow(request)` directly — no shared top-level runner is used.

### 2. Pure-data per-run request without resolved collaborators
**Status: PASS**

- `RunRequest` in `src/RunRequest.ts` is a plain TypeScript interface with only readonly primitive/array fields: `task`, `engine`, `checks`, `maxAttempts`, `gitMode`, `reportMode`.
- No Effect services, layers, callbacks, or resolved collaborators are embedded.
- Test `"request contains only execution inputs, no services or layers"` explicitly verifies no function-typed fields exist.
- Request assembly happens at CLI boundary from CLI flags + config defaults.

### 3. Engine selection through Effect service
**Status: PASS**

- `EngineResolver` in `src/EngineResolver.ts` is an Effect `Context.GenericTag` service with a `resolve(engine) => Layer<Engine>` method.
- `buildRunWorkflow` resolves the engine via `yield* EngineResolver` — not from a config bag.
- `DefaultEngineResolver` maps "claude" → `ClaudeEngineLayer`, "codex" → `CodexEngineLayer`.
- Tests verify the resolver receives the correct engine choice and different choices resolve to different layers.

### 4. RunObserver owns full lifecycle surface
**Status: PASS**

- `RunObserver` in `src/RunObserver.ts` defines four lifecycle hooks: `onStart`, `onLoopEvent`, `onAgentResult`, `onComplete`.
- `buildRunWorkflow` routes all lifecycle side effects through the observer:
  - `onStart(request)` called before execution
  - `onLoopEvent(event)` called on each loop lifecycle event (attempt_start, check_failed, success)
  - `onAgentResult(result, attempt, maxAttempts)` called after each agent execution
  - `onComplete(result)` called with final TaskResult
- Built-in implementations: `SilentRunObserver` (no-op), `LogRunObserver` (structured logging), `composeObservers()` (composition).
- Tests verify lifecycle ordering: start before loop events before complete.

### 5. No backward-compatibility preservation of old config schema
**Status: PASS**

- The CLI run path builds a `RunRequest` from config + CLI overrides, but does not preserve or depend on the old mixed config model.
- `loadConfig()` is used only to supply defaults; the workflow receives a pure-data `RunRequest`.

## Test Results

- **buildRunWorkflow.test.ts**: 19/19 pass (0 fail)
  - RunRequest purity, orchestration, engine resolution, observer lifecycle, git modes
- **Full test suite**: 672/672 pass across 36 files (0 fail, 1767 assertions)
- **Typecheck**: Clean (no errors)
- **CLI**: `ralphe run --help` works correctly, shows all expected flags

## Key Files

| File | Role |
|------|------|
| `src/RunRequest.ts` | Pure-data per-invocation request type |
| `src/RunObserver.ts` | Full-lifecycle observer service + implementations |
| `src/buildRunWorkflow.ts` | App-owned workflow builder (single step ordering location) |
| `src/EngineResolver.ts` | Effect service for engine resolution |
| `cli.ts` | CLI entry point — assembles RunRequest, provides services |
| `tests/buildRunWorkflow.test.ts` | Comprehensive workflow builder tests |
