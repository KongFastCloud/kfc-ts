# Verification: Tighten Linear Session Write Contract and Manual CLI Flow

**Date:** 2026-03-24
**Status:** ✅ PASS

## Summary

All acceptance criteria for the "Tighten the Linear session write contract and manual CLI flow" task have been verified through code review and automated test execution.

## Test Results

- **190 tests passed, 0 failed** across 9 test files
- **388 expect() assertions** all passing
- **TypeScript compilation:** clean (no errors)

## Acceptance Criteria Verification

### ✅ Start, retry/check-failed, held, success, and failure states have explicit session-write behavior

**Evidence:**

1. **Session Write Contract** is explicitly defined and documented in `src/linear/activities.ts` (lines 10-31):
   - `start` → `writeStartActivity()` — "Starting work on ENG-123"
   - `check_failed` → `writeCheckFailedActivity()` — "[attempt 1/3] Check failed — retrying\n…"
   - `success` → `writeSuccessActivity()` — "[attempt 2/3] All checks passed ✓"
   - `error` → `writeErrorActivity()` — "Failed after 3 attempt(s): …"

2. **`SessionUpdateKind` type** (line 71) enumerates all four states: `"start" | "check_failed" | "success" | "error"`

3. **Error activity doubles as durable held marker** — documented and tested. The error activity's presence (detected by `isErrorActivity()` matching "Failed after" prefix) marks an issue as error-held until a prompted follow-up clears it.

4. **Runner owns all session writes** (`src/runner.ts` lines 8-17): start and terminal writes (success/error) happen in the runner. Only intermediate check_failed events go through the onEvent callback.

5. **Tests confirm the contract:**
   - `activities.test.ts`: 30+ tests covering format functions, lifecycle event mapping, write functions, session event handler, and contract completeness assertions
   - `runner.test.ts`: Tests verify start→success, start→error, and start→check_failed→success lifecycle sequences
   - `worker.test.ts`: Tests verify error activity detection, follow-up detection, and retry flow derived from Linear activities

### ✅ The manual CLI provides a coherent operator flow for configuration visibility and safe inspection before processing

**Evidence:**

1. **Three-step operator flow** documented in `cli.ts` (lines 9-12):
   - `ralphly config` — shows resolved configuration with value sources (env vs config file)
   - `ralphly run --dry-run` — loads and classifies backlog, shows what would happen without processing
   - `ralphly run` — drains backlog sequentially, then exits with summary

2. **Configuration visibility** (`cli.ts` lines 164-196): The `config` command shows all resolved values with source hints (environment variable or config file), and clearly reports missing values with guidance.

3. **Safe inspection** (`cli.ts` lines 73-119): Dry run loads candidates, classifies each (actionable/blocked/error-held/ineligible/terminal), shows readiness and reason for each candidate, and identifies what would be processed next — all without making changes.

4. **Run command always shows config first** (`cli.ts` lines 63-69): Even the full run prints configuration summary before processing begins.

### ✅ Worker exit behavior is predictable once no actionable work remains

**Evidence:**

1. **`WorkerExitReason` type** (`src/worker.ts` lines 65-73) defines four exhaustive exit reasons:
   - `no_candidates` — nothing delegated to the agent
   - `no_actionable` — candidates exist but all blocked/held/terminal/ineligible
   - `backlog_drained` — all actionable work was processed
   - `iteration_limit` — safety bound (100 iterations)

2. **Exit summary** (`cli.ts` lines 140-158): After the worker loop completes, the CLI prints a structured summary (processed/succeeded/error-held/retried counts) and a human-readable exit message including the reason code.

3. **Worker loop terminates deterministically** (`src/worker.ts` lines 293-360): Loop runs until no actionable work remains, with a safety bound of 100 iterations. The transient in-flight set prevents double-processing within a single run.

4. **Drain tests** (`tests/drain.test.ts`): Integration tests verify sequential processing, continuation after failures, and proper exit behavior.

### ✅ The visible session behavior matches the documented worker lifecycle

**Evidence:**

1. **Documentation-code alignment**: The session write contract documented in the module docstring of `activities.ts` exactly matches the implementation in `runner.ts` and the test assertions.

2. **Contract completeness tests** (`activities.test.ts` lines 382-412):
   - Every `SessionUpdateKind` has a corresponding format function
   - Every `SessionUpdateKind` has a corresponding write function
   - Error activity body matches the detection pattern used by `isErrorActivity()`
   - Non-error activity bodies do NOT match the error detection pattern

3. **Readiness classification** (`src/readiness.ts`) uses error-held state dual-sourced from Linear:
   - Session status "error" (when Linear sets it)
   - Activity-derived: `errorHeldIds` set built from session activities (durable across process restarts)

4. **No implicit interpretation**: All state transitions map to explicit Linear activities. The error activity IS the held marker — no separate held activity or private queue.

## Architecture Notes

- **Fire-and-forget writes**: Session activity write failures log warnings but never block execution
- **Linear as source of truth**: All backlog state (error-held, readiness, selection) derived from Linear-backed state
- **Pure classification**: `readiness.ts` has no Effect or Linear SDK dependencies — fully testable independently
- **Manual CLI-first posture**: No webhooks, servers, or background automation — intentional for first operator release
