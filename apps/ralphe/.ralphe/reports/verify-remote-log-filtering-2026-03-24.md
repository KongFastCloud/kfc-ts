# Verification Report: Remote Log Filtering and Structured Fields

**Date:** 2026-03-24
**Task:** Add remote log filtering and structured fields
**Status:** PASS

## Summary

All acceptance criteria are met. The implementation correctly filters log levels for remote shipping, enforces a strict field allowlist, and excludes sensitive/high-cardinality data from remote payloads.

## Test Results

**25/25 tests pass** in `tests/remoteLogger.test.ts` (0 failures).

## Acceptance Criteria Verification

### 1. Info, warn, and error events are eligible for remote shipping — PASS

- `isRemoteEligible()` in `remoteLogger.ts:42-45` checks for `Info`, `Warning`, `Error`, and `Fatal` tags.
- Tests `buffers info-level logs`, `buffers warning-level logs`, `buffers error-level logs` all pass, confirming entries are added to the buffer.

### 2. Debug events remain local-only and are not shipped to Axiom — PASS

- `isRemoteEligible()` returns false for `Debug` and `Trace` tags.
- Tests `does NOT buffer debug-level logs` and `does NOT buffer trace-level logs` pass.
- Integration test `TuiLoggerLayer does NOT ship debug logs remotely` confirms end-to-end.
- Local file logging (`makeFileLogger`) has no level filter — all levels write to disk.

### 3. Remote log events contain only the approved structured fields — PASS

- `ALLOWED_ANNOTATION_MAP` (lines 89-106) defines an explicit allowlist of 11 annotation keys mapping to canonical remote field names: `issue.id`, `engine`, `check.name`, `trace_id`, `span_id`, `workerId`, `loop.attempt`, `loop.max_attempts`.
- `pickAllowedFields()` (lines 112-121) iterates annotations and only includes keys present in the allowlist.
- Core fields always included: `_time`, `level`, `message`.
- Key normalization works: `taskId` → `issue.id`, `attempt` → `loop.attempt`, `maxAttempts` → `loop.max_attempts`.
- Test `remote entries have only core + allowlisted keys` verifies strict contract by checking exact key set.
- Test `includes all approved structured fields when present` verifies all 8 annotation fields pass through.

### 4. Remote log payloads do not include disallowed high-cardinality or sensitive fields — PASS

- Test `excludes disallowed high-cardinality fields` verifies `issueTitle`, `prompt`, `stdout`, `stderr`, `command`, `resumeToken`, `taskText` are all absent from remote entries.
- Test `mixes allowed and disallowed fields, only allowed pass through` confirms mixed scenarios work correctly.
- Test `remote entries have only core + allowlisted keys` confirms unknown/random fields are also excluded.

## Architecture Review

| Component | File | Role |
|-----------|------|------|
| Remote logger | `src/remoteLogger.ts` | Axiom sink with level filtering & field allowlist |
| Logger composition | `src/logger.ts` | Composes stderr + file + remote loggers |
| Initialization | `cli.ts` | Calls `initRemoteLogger()` at startup, `shutdownRemoteLogger()` on exit |

- **Fail-open:** Missing config → silent no-op. Network errors → logged locally, never propagate. All 3 fail-open tests pass.
- **Buffer management:** 50-entry max buffer, 5-second flush interval, unref'd timer.
- **Dataset separation:** Uses `AXIOM_LOG_DATASET` (not `AXIOM_DATASET` used for traces). Verified by test.

## Files Inspected

- `apps/ralphe/src/remoteLogger.ts` (269 lines)
- `apps/ralphe/src/logger.ts` (86 lines)
- `apps/ralphe/tests/remoteLogger.test.ts` (482 lines)
