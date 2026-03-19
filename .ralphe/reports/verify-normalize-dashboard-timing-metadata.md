# Verification Report: Normalize Dashboard Timing Metadata Parsing

**Date:** 2026-03-19
**Status:** PASS

## Summary

Verified that dashboard timing metadata parsing correctly normalizes ralphe metadata
from both structured objects and serialized JSON strings before reaching the dashboard
row model.

## Acceptance Criteria Verification

### 1. Extracts startedAt when ralphe metadata is a structured object
**PASS** — `normalizeRalpheMeta()` in `beadsAdapter.ts` (line 235-240) checks
`typeof ralphe === "object"` and extracts `startedAt`/`finishedAt` with type guards.
Test `beadsAdapterTiming.test.ts` confirms extraction from structured payloads.

### 2. Extracts startedAt and finishedAt when ralphe metadata is a serialized JSON string
**PASS** — `normalizeRalpheMeta()` (line 243-256) handles `typeof ralphe === "string"`
by `JSON.parse`-ing and extracting fields. Tests confirm both `startedAt` and
`finishedAt` are extracted from serialized strings.

### 3. Invalid or missing ralphe metadata does not crash parsing
**PASS** — The function returns `undefined` for:
- Missing metadata (null/undefined ralphe)
- Metadata without ralphe namespace
- Invalid JSON strings ("not valid json {{{")
- Serialized non-objects (e.g., `JSON.stringify(42)`)
All edge cases tested and passing.

### 4. No change to dashboard status semantics or new timing fields
**PASS** — `mapStatus()` is unchanged. Only `startedAt` and `finishedAt` were added
to `WatchTask`. `computeDuration()` uses existing status values to determine behavior.
No new timing fields introduced.

## Test Results

```
36 pass, 0 fail, 74 expect() calls
Ran 36 tests across 3 files [115.00ms]
```

### Test files:
- `beadsAdapterTiming.test.ts` — 8 tests covering structured/serialized/invalid metadata
- `duration.test.ts` — 16 tests covering formatDuration and computeDuration
- `dashboard.test.ts` — 12 tests covering partitioning and formatting

## Implementation Details

- **normalizeRalpheMeta()** in `apps/ralphe/src/beadsAdapter.ts` (lines 228-259)
  handles both object and string payloads with safe fallbacks.
- Called at line 322 during `bdIssueToWatchTask()`, results mapped to `startedAt`/`finishedAt`
  on `WatchTask` (lines 343-344).
- `RalpheTimingMeta` interface limits fields to `startedAt` and `finishedAt` only.
- `BdIssueJson.metadata.ralphe` type allows `object | string` to model both payload shapes.
