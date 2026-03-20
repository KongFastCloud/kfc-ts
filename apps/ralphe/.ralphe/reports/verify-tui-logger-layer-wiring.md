# Verification Report: Wire TuiLoggerLayer into watch command

**Date:** 2026-03-20
**Status:** PASS

## Summary

The TuiLoggerLayer has been correctly wired into the watch command to suppress stderr logging while the TUI is rendering.

## Implementation Verified

### 1. TuiLoggerLayer Definition (`src/logger.ts:86-89`)
- Uses only `makeFileLogger()` (JSON lines to `.ralphe/logs/`)
- Does **not** include `stderrLogger`, so no logfmt text bleeds into the TUI
- Includes `ensureLogDir` to guarantee the log directory exists

### 2. Watch Command Handler (`cli.ts:205-228`)
- **TUI mode (default):** `launchWatchTui()` is wrapped with `Effect.provide(TuiLoggerLayer)` (line 220-225), which overrides the global `AppLoggerLayer` via Effect's innermost-wins layer semantics
- **Headless mode (`--headless`):** Uses the default `AppLoggerLayer` (logs to both stderr and file), which is correct since there's no TUI to corrupt

### 3. Global AppLoggerLayer Unchanged (`cli.ts:244`)
- `AppLoggerLayer` is still applied globally via `Effect.provide(Layer.merge(BunContext.layer, AppLoggerLayer))`
- Non-TUI commands (`ralphe run`, `ralphe config`, `ralphe skill`) continue to log to stderr as before

### 4. No Log Call Sites Changed
- The implementation only changes the logger layer injection — no log call sites in watcher.ts, agent.ts, git.ts, loop.ts, runTask.ts, cmd.ts, report.ts, beadsAdapter.ts, or engine files were modified

## Test Results

All 3 logger tests pass:

| Test | Result |
|------|--------|
| TuiLoggerLayer writes log entries to JSON lines file | PASS |
| TuiLoggerLayer does NOT write to stderr | PASS |
| AppLoggerLayer writes to both file and stderr | PASS |

## Type Check

TypeScript compilation (`tsc --noEmit`) passes with zero errors.

## Acceptance Criteria

- [x] `ralphe watch` no longer shows logfmt text in the TUI display (TuiLoggerLayer suppresses stderr)
- [x] Logs from watch-mode operations still appear in `.ralphe/logs/` JSON lines files (makeFileLogger is active)
- [x] Non-TUI commands (`ralphe run`) still log to stderr as before (AppLoggerLayer applied globally)
