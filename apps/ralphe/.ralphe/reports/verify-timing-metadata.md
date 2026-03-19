# Verification Report: Persist Latest-Run Timing Metadata And Render Duration Column

**Date:** 2026-03-19
**Status:** PASS

## Acceptance Criteria Verification

### 1. Execution metadata stores startedAt when a task run begins
**PASS**

Both executor paths (`watcher.ts` line 91 and `tuiWorker.ts` line 140) capture `startedAt = new Date().toISOString()` immediately after claiming a task. This timestamp is written to metadata via `writeMetadata()` before execution begins. The `BeadsMetadata` interface in `beads.ts` (line 22-23) includes `startedAt?: string | undefined` with JSDoc noting it is an ISO-8601 timestamp captured when the latest run begins.

### 2. Execution metadata stores finishedAt when a task run ends in done or error
**PASS**

Both executor paths capture `finishedAt = new Date().toISOString()` after task execution completes (`watcher.ts` line 107, `tuiWorker.ts` line 174). The `finalMetadata` object includes both `startedAt` and `finishedAt` and is persisted via `writeMetadata()` for success paths and via `markTaskExhaustedFailure()` for error paths. The `BeadsMetadata` interface (line 24-25) includes `finishedAt?: string | undefined`.

### 3. Active dashboard rows display live elapsed time using issue metadata rather than local worker state
**PASS**

`computeDuration()` in `DashboardView.tsx` (line 106-109) computes live elapsed time for active tasks as `Date.now() - startMs` where `startMs` comes from `task.startedAt` (parsed from metadata). There is no reference to local worker state — the duration is derived entirely from the persisted `startedAt` metadata field, which survives refreshes and restarts.

### 4. Done and error dashboard rows display final run duration derived from metadata timestamps
**PASS**

`computeDuration()` (lines 112-117) computes final duration for done/error tasks as `endMs - startMs` where both values come from metadata fields `finishedAt` and `startedAt`. Tests in `duration.test.ts` confirm: a done task with start `2025-01-01T00:00:00.000Z` and finish `2025-01-01T00:02:30.000Z` yields `"2m 30s"`, and an error task spanning 1h 15m yields `"1h 15m"`.

### 5. Backlog, actionable, blocked, and incomplete-metadata rows display - for Duration
**PASS**

`computeDuration()` (lines 96-98) returns `"—"` for backlog, actionable, and blocked statuses regardless of timestamps. Lines 101 and 104 return `"—"` when `startedAt` is missing or invalid. Lines 113 and 115 return `"—"` when `finishedAt` is missing or invalid for done/error tasks. Tests confirm all these cases.

## Design Constraints Verification

- **No attempt history or retry history stored:** Only latest-run `startedAt` and `finishedAt` are stored — no arrays, no attempt counts in timing metadata.
- **No separate durationMs field:** Duration is always computed from `finishedAt - startedAt`, never stored as a separate field.
- **Metadata namespace:** Timing is stored under the `ralphe` metadata namespace via `bd update <id> --set-metadata ralphe=<JSON>`.
- **Adapter passthrough:** `beadsAdapter.ts` (lines 293-294) maps `item.metadata?.ralphe?.startedAt` and `finishedAt` directly to `WatchTask` fields.

## Test Results

- `tests/duration.test.ts`: 14 tests PASS (formatDuration + computeDuration)
- `tests/beadsAdapterTiming.test.ts`: 4 tests PASS (metadata passthrough)
- `tests/watchLifecycle.test.ts`: 20 tests PASS (full lifecycle including metadata timing)
- Full test suite: **209 tests PASS**, 0 failures across 19 files
