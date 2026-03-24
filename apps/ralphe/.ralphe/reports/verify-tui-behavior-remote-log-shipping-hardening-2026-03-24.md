# Verification: Preserve TUI behavior and harden remote log shipping tests

**Date:** 2026-03-24
**Status:** PASS

## Summary

All acceptance criteria for the TUI behavior preservation and remote log shipping hardening slice are met. The implementation includes comprehensive test coverage across two test files (48 total tests, all passing) that verify the intended runtime behavior without any live Axiom dependency.

## Acceptance Criteria Verification

### 1. TUI mode suppresses stderr while remote shipping remains active — PASS

**Evidence:**
- `TuiLoggerLayer` in `src/logger.ts` composes only `makeFileLogger()` and `getRemoteLogger()`, deliberately omitting the `stderrLogger`. This structurally guarantees no stderr output from Effect logging in TUI mode.
- `remoteLogShippingHardening.test.ts` includes three TUI-specific tests:
  - `processClaimedTask under TuiLoggerLayer: stderr suppressed, remote buffered, file written` — intercepts `console.error`, confirms no milestone messages leak to stderr, confirms remote buffer populated, confirms file log written.
  - `pollClaimAndProcess failure under TuiLoggerLayer: stderr clean, warning in remote buffer` — verifies warning-level milestones reach remote buffer without stderr noise.
  - `TUI controller worker with remote logger: stderr clean, remote buffer populated` — exercises the real `tuiWorkerEffect` + `createTuiWatchController` path, confirming stderr suppression and remote buffering at the orchestration layer.

### 2. Info, warn, and error logs ship remotely; debug remains local-only — PASS

**Evidence:**
- `remoteLogger.ts` `isRemoteEligible()` only accepts `Info`, `Warning`, `Error`, and `Fatal` tags.
- `remoteLogShippingHardening.test.ts` tests:
  - `debug-level logs emitted during workflow do not ship remotely` — emits debug via `queryQueued`, confirms absence from buffer.
  - `info logs ship while debug logs from the same workflow do not` — mixed levels in one workflow, only info milestones buffered.
  - `all four remote-eligible levels ship in a single workflow` — verifies INFO, WARN, ERROR, FATAL all reach buffer.
  - `debug and trace levels are excluded even when interleaved with eligible levels` — interleaved debug/trace/info/warn/error, only 3 eligible entries buffered.
- `remoteLogger.test.ts` has 7 additional level-filtering tests confirming the policy at the unit level.

### 3. Missing config or remote export failures do not break ralphe run or ralphe watch — PASS

**Evidence:**
- `remoteLogShippingHardening.test.ts` fail-open tests:
  - `processClaimedTask succeeds with no AXIOM env vars` — full success path, zero remote buffer entries.
  - `processClaimedTask failure path works with no remote config` — failure path completes normally.
  - `pollClaimAndProcess NoneReady path works with no remote config` — idle cycle completes.
  - `pollClaimAndProcess full success path works with no remote config` — full claim-process-close cycle.
  - `processClaimedTask succeeds with only AXIOM_TOKEN set (incomplete config)` — partial config gracefully degrades.
- `remoteLogger.ts` fail-open design: `initRemoteLogger()` wraps init in try-catch, `flush()` wraps network calls in try-catch, `drainBuffer()` is fire-and-forget. Network errors are logged locally via `console.error` but never propagated.
- Test output confirms `ConnectionRefused` errors from fake Axiom URLs are handled gracefully (logged as non-fatal, tests pass).

### 4. Test strategy does not depend on live Axiom access — PASS

**Evidence:**
- All tests use `_resetForTesting()` and `_getBufferForTesting()` test seams from `remoteLogger.ts` to inspect buffered entries deterministically.
- Axiom env vars are set to `https://example.axiom.co` (unreachable), confirming no live network dependency.
- No global mocking patterns — uses dependency injection seams (`WatchWorkflowDeps`, `TuiWorkerDeps`, `TuiWatchControllerDeps`) consistent with the repo's existing style.
- Buffer inspection is synchronous and deterministic — no timing-dependent assertions on network responses.

## Test Results

| Test File | Tests | Pass | Fail |
|-----------|-------|------|------|
| `tests/remoteLogShippingHardening.test.ts` | 23 | 23 | 0 |
| `tests/remoteLogger.test.ts` | 25 | 25 | 0 |
| **Total** | **48** | **48** | **0** |

## Architecture Notes

- **Logger layers**: `AppLoggerLayer` = stderr + file + remote; `TuiLoggerLayer` = file + remote (no stderr). Both compose via `Logger.zip` and `Logger.replace`.
- **Remote sink**: In-memory buffer with 50-entry / 5-second flush policy. `drainBuffer()` is fire-and-forget. Timer is `unref()`'d to avoid blocking process exit.
- **Field allowlist**: `ALLOWED_ANNOTATION_MAP` maps internal annotation keys to canonical remote field names. Sensitive fields (issueTitle, prompt, stdout, stderr, command, resumeToken) are excluded by omission.
- **Test seams**: `_resetForTesting()` clears module state; `_getBufferForTesting()` returns the current buffer. No monkey-patching or global mocks.

## Conclusion

The implementation correctly preserves TUI stderr suppression, enforces the remote log level policy, handles missing/broken remote config gracefully, and is fully testable without live Axiom access. All 48 tests pass consistently.
