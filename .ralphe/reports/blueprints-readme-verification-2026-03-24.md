# Verification Report: Document the blueprints runner contract and usage

**Date:** 2026-03-24
**Status:** PASS

## Summary

All acceptance criteria are met. The blueprints README accurately documents the runner contract, and all 28 tests pass.

## Acceptance Criteria Verification

### 1. README exists and explains what the package is, is not, and how to use it
**PASS** — `packages/blueprints/README.md` exists with sections:
- "What blueprints owns" (retry loop, lifecycle events, pipeline orchestration, result shaping, error classification)
- "What blueprints does not own" (tracker state, prompt assembly policy, durable queueing, engine implementation)
- Quick start example, full API reference, and caller responsibilities

### 2. Documented retry model matches ralphe-style loop semantics
**PASS** — Verified against `src/loop.ts` and `tests/loop.test.ts`:
- README states feedback is `undefined` on first attempt → matches `loop.ts` line 43: `{ attempt: 1, feedback: undefined, done: false }`
- README states feedback format is `Command "<command>" failed (exit <code>):\n<stderr>` → matches `loop.ts` line 69
- README states `CheckFailure` escalates to `FatalError` after max attempts → matches `loop.ts` lines 61-66
- README states `check_failed` is not emitted on final attempt → matches code and test (`onEvent check_failed is not emitted on final attempt`)
- README states default `maxAttempts` is 2 → matches `loop.ts` line 36: `const maxAttempts = opts?.maxAttempts ?? 2`
- README states feedback is appended as `"\n\nPrevious attempt failed:\n<feedback>"` → matches `agent.ts` line 24

### 3. Documented lifecycle event and result contract matches exported API and tests
**PASS** — Verified against source and tests:
- `LoopEvent` interface: `type`, `attempt`, `maxAttempts`, `feedback?` → matches `loop.ts` lines 14-19
- Event types: `attempt_start | check_failed | success` → matches `loop.ts` line 12
- `RunResult` fields: `success`, `resumeToken?`, `error?`, `attempts` → matches `runner.ts` lines 58-64
- `RunnerOptions` fields: `task`, `config`, `engineLayer`, `onEvent?`, `onAgentResult?`, `gitOps?` → matches `runner.ts` lines 154-175
- `RunConfig` fields: `maxAttempts`, `checks`, `gitMode`, `report` → matches `runner.ts` lines 47-52
- `Engine` interface: `execute(prompt, workDir)` returning `Effect<AgentResult, CheckFailure | FatalError>` → matches `engine.ts`
- `AgentResult`: `response`, `resumeToken?` → matches `engine.ts` lines 11-14
- `CheckFailure`: `command`, `stderr`, `exitCode` → matches `errors.ts` lines 9-13
- `FatalError`: `command`, `message` → matches `errors.ts` lines 15-18
- `run()` never fails (errors captured in RunResult) → matches `runner.ts` lines 246-255 (`catchTag("FatalError")`)
- Event sequences documented match test assertions in `loop.test.ts` lines 132-166

### 4. Slice does not migrate ralphe or add tracker-specific behavior
**PASS** — No tracker imports, no Linear/Beads references in blueprints source. The README explicitly states tracker state is caller-owned. No ralphe migration code present.

## Test Results

All **28 tests** across 5 files pass:
- `tests/cmd.test.ts` — command execution
- `tests/loop.test.ts` — retry loop, feedback propagation, lifecycle events
- `tests/runner.test.ts` — full pipeline, result shaping, callbacks
- `tests/errors.test.ts` — error classification
- `tests/engine.test.ts` — engine interface

## Additional Observations

- All public API types documented in README are exported from `src/index.ts`
- Git mode documentation accurately reflects the implementation (CI mode inside loop, others post-loop)
- Report mode documentation matches `src/report.ts` (browser/basic modes, `.blueprints/reports/` default dir)
- The `loop()` primitive is documented as exported for lower-level composition, which matches `src/index.ts` exports
