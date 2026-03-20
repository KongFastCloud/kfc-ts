# Verification Report: Reload config per iteration in both watch loops

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Results

| Criteria | Status | Details |
|----------|--------|---------|
| watcher.ts calls loadConfig inside the poll loop | PASS | Line 78 — inside `Effect.iterate` body |
| tuiWorker.ts calls loadConfig inside the poll loop | PASS | Line 123 — inside `while (!stopped)` loop |
| Config changes take effect on next task | PASS | loadConfig reads from disk each call, no caching |
| Unit test in config.test.ts verifies reload | PASS | `describe("loadConfig reload")` at line 129 — writes config, calls loadConfig, mutates file, calls loadConfig again, asserts new values |
| pnpm run typecheck passes | PASS | 5/5 tasks successful |
| bun test passes | PASS | 388 tests, 0 failures |

## Implementation Details

### watcher.ts (line 78)
`loadConfig(workDir)` is called at the top of the `Effect.iterate` body, ensuring each poll iteration gets a fresh `RalpheConfig`. The config is used downstream for `config.engine` and task execution parameters.

### tuiWorker.ts (line 123)
`loadConfig(workDir)` is called at the top of the `while (!stopped)` loop body. The config is used for `config.engine` and passed to `runTask`.

### config.test.ts (lines 129-147)
The "loadConfig reload" test suite writes an initial config `{engine: "claude", maxAttempts: 2}`, verifies it, then mutates the file to `{engine: "codex", maxAttempts: 5}` and confirms loadConfig returns the updated values.

### config.ts
`loadConfig()` reads `.ralphe/config.json` from disk on every call with no caching. Returns `DEFAULTS` on missing file or parse errors, making mid-save races safe.

## Test Results
- **Typecheck:** 5/5 cached, all passed
- **Unit tests:** 388 pass, 0 fail, 915 expect() calls across 22 files
