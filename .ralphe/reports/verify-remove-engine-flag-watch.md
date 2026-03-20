# Verification Report: Remove --engine flag from watch subcommand

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Verification

### 1. Watch subcommand no longer accepts --engine flag
**PASS** - The `watchCmd` in `cli.ts` (line 202-220) only accepts `{ interval, headless }` options. No engine flag is defined or referenced in the watch command definition.

### 2. WatcherOptions interface has no engineOverride field
**PASS** - `WatcherOptions` in `src/watcher.ts` (lines 19-28) contains only: `pollIntervalMs`, `workerId`, `maxTasks`, `workDir`. No `engineOverride` field.

### 3. TuiWorkerOptions interface has no engineOverride field
**PASS** - `TuiWorkerOptions` in `src/tuiWorker.ts` (lines 52-59) contains only: `pollIntervalMs`, `workerId`, `workDir`. No `engineOverride` field.

### 4. Metadata writes use config.engine directly
**PASS** - In `watcher.ts` line 112: `engine: config.engine` (start metadata) and line 129: `engine: result.engine` (final metadata).
In `tuiWorker.ts` line 166: `engine: config.engine` (start metadata) and line 203: `engine: result.engine` (final metadata).
No references to `engineOverride` in either file.

### 5. runTask calls in both watchers pass no engineOverride
**PASS** - `watcher.ts` line 124: `runTask(prompt, config)` — no third argument.
`tuiWorker.ts` line 187: `runTask(prompt, config)` — no third argument.

### 6. pnpm run typecheck passes
**PASS** - All 5 packages typecheck successfully (full turbo cache hit).

## Additional Verification

- **watchTui.tsx passthrough**: `startTuiWorker` is called (line 99) with only `{ pollIntervalMs, workDir }` options — no engine parameter passed through.
- **Remaining engineOverride references**: Only exist in `cli.ts` (run command, lines 127/142/167) and `runTask.ts` (lines 111/115), which is correct per the design — the `run` subcommand retains its `--engine` flag.
- **No watchEngineFlag references**: Zero matches in the entire codebase.

## Conclusion

All acceptance criteria are met. The `--engine` flag has been cleanly removed from the watch subcommand while preserved in the run subcommand. Both watcher implementations use `config.engine` directly.
