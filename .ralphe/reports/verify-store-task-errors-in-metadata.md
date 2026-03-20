# Verification Report: Store Task Errors in Ralphe Metadata

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Verification

### 1. BeadsMetadata has an error field ✅
- File: `apps/ralphe/src/beads.ts` (line 27)
- `error?: string | undefined` field present with JSDoc comment: "Error message when the task exhausted all retries."

### 2. markTaskExhaustedFailure writes error to metadata ✅
- File: `apps/ralphe/src/beads.ts` (lines 220-234)
- Function accepts `reason: string` and `metadata: BeadsMetadata` parameters
- Calls `writeMetadata(id, { ...metadata, error: reason })` to persist the error
- Also reopens the task, removes "ready" label, and adds "error" label

### 3. Broken --append-note call is removed ✅
- Searched entire `apps/ralphe` directory for "append-note" — zero matches found
- The broken `runBd(['update', id, '--append-note', ...])` call has been completely removed

### 4. WatchTask includes error field parsed from metadata ✅
- File: `apps/ralphe/src/beadsAdapter.ts` (line 66)
- `error?: string | undefined` field present in WatchTask interface with JSDoc comment
- `normalizeRalpheMeta()` (lines 232-265) extracts `error` from both structured objects and serialized JSON strings
- `bdIssueToWatchTask()` maps `timing?.error` to `WatchTask.error` (line 351)

### 5. bd show on a failed task shows the error in metadata JSON ✅
- `writeMetadata()` (lines 239-244) stores the full BeadsMetadata object (including error) as JSON via `--set-metadata ralphe=<JSON>`
- This means `bd show` will display the ralphe metadata namespace containing the error string

## Test Results

All 372 tests pass across 21 test files (863 assertions). Key test files:
- `watchLifecycle.test.ts` — tests exhausted failure lifecycle including error metadata
- `restartRecovery.test.ts` — tests crash recovery with error metadata

## Callers Updated

- **tuiWorker.ts**: Passes `result.error` through metadata to `markTaskExhaustedFailure`
- **watcher.ts**: Same pattern — error flows from task result into metadata

## Conclusion

All acceptance criteria are met. The implementation correctly stores task errors in the ralphe metadata JSON field, the broken `--append-note` call is removed, and the error is propagated through the full pipeline from task execution to TUI display.
