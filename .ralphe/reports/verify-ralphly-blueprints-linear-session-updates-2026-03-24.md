# Verification Report: Run One Linear Issue Through Blueprints and Write Session Updates

**Date**: 2026-03-24
**Status**: PASS

## Summary

Verified that ralphly can build task input for one Linear issue/session, invoke blueprints, and write visible session updates back to Linear at key lifecycle milestones (start, retry/check-failed, success, error).

## Acceptance Criteria Verification

### 1. Ralphly can build task input for one Linear issue/session and invoke blueprints
**PASS**

- `buildTaskInput()` in `apps/ralphly/src/runner.ts` constructs prompts from issue title + description via `buildPromptFromIssue()`
- Appends `## Previous Attempt Feedback` section when retry feedback is provided
- `runIssue()` invokes `blueprintsRun()` with the constructed task, config, and engine layer
- Tests verify: prompt includes title/description, no feedback when undefined, feedback appended when present (5 tests)

### 2. Ralphly writes a start acknowledgement to the session when processing begins
**PASS**

- `runIssue()` calls `writeActivity(client, session.id, formatStartActivity(issue.identifier))` before invoking blueprints
- `formatStartActivity("ENG-123")` produces `"Starting work on ENG-123"`
- Test `"writes start activity when processing begins"` confirms the first activity call is the start acknowledgement with correct session ID and body

### 3. Ralphly writes retry/check-failed, success, and error updates based on blueprints lifecycle outcomes
**PASS**

- **check_failed**: `mapLoopEventToActivity()` maps `check_failed` LoopEvent to formatted activity body: `[attempt N/M] Check failed -- retrying\n{feedback}`
- **success**: Maps `success` LoopEvent to: `[attempt N/M] All checks passed`
- **error**: `formatErrorActivity()` produces: `Failed after N attempt(s): {error}` - written after terminal failure in `runIssue()`
- `onEvent` callback in `runIssue()` wires blueprints LoopEvents to session activity writes via `mapLoopEventToActivity()`
- Tests verify all four activity types with mock Linear client (18+ assertions across activities.test.ts and runner.test.ts)

### 4. The session update mapping is explicit and testable
**PASS**

- `SessionUpdateKind` type: `"start" | "check_failed" | "success" | "error"` - explicitly defined in `activities.ts`
- `mapLoopEventToActivity()` is a pure function returning `{ kind: SessionUpdateKind; body: string } | null`
- Each format function is independently testable: `formatStartActivity`, `formatCheckFailedActivity`, `formatSuccessActivity`, `formatErrorActivity`
- `makeSessionEventHandler()` factory builds reusable event handlers for a session
- Comprehensive test coverage in `tests/linear/activities.test.ts` (14 tests) and `tests/runner.test.ts` (10 tests)

### 5. The integration proves blueprints can power a real Linear-backed issue run
**PASS**

- `runIssue()` demonstrates the full integration path: Linear context -> task input -> blueprints execution -> session activity writes -> structured result
- Uses Effect dependency injection for both `Engine` and `Linear` services, enabling real and mock implementations
- Fire-and-forget activity writing pattern (errors logged, never propagated) matches production requirements
- Resume token propagation from agent execution through to `IssueRunResult` supports future follow-up handling

## Test Results

### Blueprints Package
```
28 pass, 0 fail, 53 expect() calls
Ran 28 tests across 5 files [153ms]
```

### Ralphly Application
```
54 pass, 0 fail, 114 expect() calls
Ran 54 tests across 5 files [143ms]
```

### TypeScript Compilation
- `apps/ralphly/tsconfig.json`: PASS (exit 0)
- `packages/blueprints/tsconfig.json`: PASS (exit 0)

## Architecture Notes

- **Separation of concerns**: blueprints handles execution semantics (retry loop, checks, git); ralphly handles Linear orchestration (sessions, activities, issue loading)
- **Effect-based DI**: Engine and Linear are Context tags, making testing trivial via `Layer.succeed()`
- **Fire-and-forget writes**: Session activity writes never block execution; failures log warnings only
- **Caller-prepared input**: blueprints never loads config or manages sessions - the caller (ralphly) handles all Linear-specific orchestration

## Non-goals Confirmed Not Implemented
- No backlog draining (single issue path only)
- No webhook infrastructure
- No ralphe migration

## Key Files
- `apps/ralphly/src/runner.ts` - Issue runner integrating blueprints with Linear
- `apps/ralphly/src/linear/activities.ts` - Session activity formatting and writing
- `packages/blueprints/src/runner.ts` - Execution runner with retry loop
- `packages/blueprints/src/loop.ts` - Retry loop with feedback propagation
