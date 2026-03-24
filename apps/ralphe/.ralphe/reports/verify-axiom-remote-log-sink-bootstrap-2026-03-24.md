# Verification Report: Bootstrap Axiom Remote Log Sink for Ralphe

**Date:** 2026-03-24
**Status:** PASS

## Summary

The Axiom remote log sink has been correctly implemented. All acceptance criteria are met.

## Acceptance Criteria Verification

| Criteria | Status | Evidence |
|----------|--------|----------|
| Ralphe can ship a simple operational info log to Axiom | PASS | `remoteLogger.ts` buffers info/warn/error/fatal entries and flushes to `${domain}/v1/datasets/${dataset}/ingest` via HTTP POST with Bearer auth |
| CLI run, headless watch, and TUI watch all use the same bootstrap path | PASS | `initRemoteLogger()` called once in `runCli()` (cli.ts:248); `AppLoggerLayer` (CLI + headless) and `TuiLoggerLayer` (TUI) both compose `getRemoteLogger()` |
| Missing or invalid Axiom config degrades to local-only without failing | PASS | `readAxiomLogConfig()` returns `undefined` if any of AXIOM_TOKEN/AXIOM_LOG_DATASET/AXIOM_DOMAIN missing; `getRemoteLogger()` returns no-op; init wrapped in try/catch |
| Existing local file logging remains intact | PASS | `AppLoggerLayer` zips stderr + file + remote; `TuiLoggerLayer` zips file + remote; file logger unchanged from before |

## Implementation Review

### Files Added/Modified

- **`src/remoteLogger.ts`** (226 lines) — New module implementing the Axiom remote log sink
- **`src/logger.ts`** — Modified to compose `getRemoteLogger()` into both `AppLoggerLayer` and `TuiLoggerLayer`
- **`cli.ts`** — Added `initRemoteLogger()` at startup and `shutdownRemoteLogger()` at exit
- **`tests/remoteLogger.test.ts`** (350 lines) — Comprehensive test suite

### Architecture

1. **Configuration:** Reads `AXIOM_TOKEN`, `AXIOM_LOG_DATASET`, `AXIOM_DOMAIN` from process.env (Bun auto-loads `.env.local`)
2. **Level policy:** Only info, warn, error, fatal are shipped remotely; debug stays local-only
3. **Buffering:** In-memory buffer (max 50 entries) with periodic flush every 5 seconds via `setInterval` (unref'd so it doesn't block exit)
4. **Fail-open:** Missing config → silent no-op; init failure → caught and logged; network failure → caught and logged; none propagate exceptions
5. **Single bootstrap:** `initRemoteLogger()` is idempotent, called once in `runCli()`; the Effect Logger returned by `getRemoteLogger()` is shared across all execution paths

### Execution Path Wiring

| Mode | Logger Layer | Remote Sink | Stderr |
|------|-------------|-------------|--------|
| CLI run (`ralphe run`) | AppLoggerLayer | Yes | Yes |
| Headless watch (`ralphe watch --headless`) | AppLoggerLayer | Yes | Yes |
| TUI watch (`ralphe watch`) | TuiLoggerLayer | Yes | No (suppressed) |

### Test Results

- **remoteLogger.test.ts:** 20/20 tests pass (level filtering, fail-open, annotations, integration with AppLoggerLayer and TuiLoggerLayer)
- **logger.test.ts:** 3/3 tests pass (file logging, stderr suppression in TUI mode)

### Key Design Properties

- Uses separate `AXIOM_LOG_DATASET` env var (distinct from tracing's `AXIOM_DATASET`)
- Flush is fire-and-forget (`void flush(entries)`) — never blocks the Effect runtime
- `shutdownRemoteLogger()` performs best-effort flush on process exit
- `_resetForTesting()` and `_getBufferForTesting()` enable deterministic local testing without live Axiom access
