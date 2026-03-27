# Verification Report: Copy-Ignored Primitive with .worktreeinclude Support

**Date:** 2026-03-27
**Task:** Blueprints: add copy-ignored primitive with .worktreeinclude support
**Status:** PASS

## Summary

The copy-ignored primitive has been correctly implemented in `packages/blueprints/src/copy.ts` with full test coverage in `packages/blueprints/tests/copy.test.ts`. All acceptance criteria are met.

## Files Reviewed

| File | Status |
|------|--------|
| `packages/blueprints/src/copy.ts` | New (298 lines) |
| `packages/blueprints/tests/copy.test.ts` | New (325 lines) |
| `packages/blueprints/src/index.ts` | Modified (exports added) |

## Acceptance Criteria Verification

### 1. Primitive discovers git-ignored entries from source workspace using repository ignore semantics
**PASS** — `discoverIgnoredEntries()` uses `git ls-files --ignored --exclude-standard -o --directory` to discover ignored entries. Tests confirm:
- Discovers ignored files in a git repo
- Discovers ignored directories (trailing `/` stripped)
- Returns empty array when nothing is ignored
- Does not include tracked files
- Fails with FatalError for non-git directory

### 2. When .worktreeinclude exists, only listed entries are copied; when absent, all ignored entries are copied
**PASS** — `readWorktreeInclude()` parses the file (newline-separated, supports `#` comments and blank lines). `filterByWorktreeInclude()` applies allowlist filtering with exact match and nested path support. Tests confirm:
- `.worktreeinclude` narrowing: only `secret.env` copied when listed, `node_modules/` and `build/` excluded
- All entries copied when `.worktreeinclude` absent
- Comment lines, empty lines, and whitespace handled correctly
- Trailing slashes normalized

### 3. Destination overwrite semantics are applied consistently
**PASS** — `copyEntry()` uses `fs.cpSync(..., { recursive: true, force: true })` for directories and `fs.copyFileSync()` for files. Symlinks are unlinked then recreated. Test confirms existing file `OLD_VALUE` is overwritten with `NEW_VALUE`.

### 4. Non-copyable entries are handled safely and surfaced through explicit failure signaling
**PASS** — `copyEntry()` checks `lstat` and skips sockets, block/char devices, and FIFOs with a descriptive reason. Copy failures are collected and surfaced as `FatalError` with entry names listed. The `CopyIgnoredResult` type includes `failures: ReadonlyArray<{ entry, reason }>`.

## Test Results

```
27 pass, 0 fail, 37 expect() calls (copy.test.ts)
107 pass, 0 fail, 172 expect() calls (all blueprints tests)
```

TypeScript type-checking: **Clean** (no errors with project tsconfig)

## Design Compliance

- **Effect-native**: All side-effectful operations use `Effect.gen`, `Effect.tryPromise`, `Effect.logInfo/logWarning`, `Effect.fail`, `Effect.annotateLogs`, `Effect.withLogSpan`
- **Tracker-agnostic**: No references to Beads, Linear, epic/task concepts
- **Explicit inputs**: Source and destination are explicit parameters; no `process.cwd()` defaults
- **Error model**: Uses existing `FatalError` tagged error from `./errors.js`
- **Exported from index.ts**: `discoverIgnoredEntries`, `readWorktreeInclude`, `filterByWorktreeInclude`, `copyIgnored`, and `CopyIgnoredResult` type

## Test Coverage Assessment

| Contract | Tests |
|----------|-------|
| `readWorktreeInclude` | 6 tests (undefined when missing, parse entries, empty lines, comments, whitespace, empty result) |
| `filterByWorktreeInclude` | 8 tests (exact match, nested entries, parent dir match, no match, multiple includes, trailing slashes, empty includes, empty entries) |
| `discoverIgnoredEntries` | 5 tests (files, directories, empty, tracked exclusion, non-git failure) |
| `copyIgnored` (e2e) | 8 tests (copy files, overwrite, worktreeinclude narrowing, copy all, zero copies, nested dirs, non-git failure, failure contract) |
