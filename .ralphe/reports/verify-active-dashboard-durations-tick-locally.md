# Verification Report: Make Active Dashboard Durations Tick Locally

**Date:** 2026-03-19
**Status:** PASS

## Summary

The feature correctly implements a local UI tick that makes active dashboard durations visibly advance while a task is running, without increasing backend polling frequency.

## Acceptance Criteria Verification

### 1. Active dashboard row with valid startedAt shows elapsed duration and visibly advances over time
**PASS** — `computeDuration()` (DashboardView.tsx:117-143) calculates live elapsed time via `Date.now() - startMs` for active tasks with valid `startedAt`. The `useDurationTick` hook triggers a React re-render every 1 second, causing `computeDuration` to recalculate with the updated `Date.now()`. Test `duration.test.ts` line 78-86 confirms active tasks with startedAt produce an elapsed duration string.

### 2. The live duration update uses a local UI tick rather than a one-second Beads refresh
**PASS** — `useDurationTick` (DashboardView.tsx:391-411) uses `setInterval` at 1,000ms to increment a React state counter, triggering re-renders. The tick value itself is unused — it only forces React to re-render. No backend calls (`bd list`) are made by the tick. The interval is purely a render-tick, not a data-fetch.

### 3. The local tick runs only when at least one active dashboard task has usable startedAt metadata
**PASS** — `hasActiveTimedTask()` (DashboardView.tsx:371-379) checks that at least one task has `status === "active"` and a valid `startedAt` (parseable as a Date). The `useEffect` in `useDurationTick` is gated on `needsTick` and clears the interval when `needsTick` becomes false. Six unit tests in `hasActiveTimedTask` describe block validate the activation/deactivation rules.

### 4. Done and error rows continue to show final duration; backlog/actionable/blocked continue to show dash
**PASS** — `computeDuration()` returns:
- `"—"` for backlog, actionable, blocked (line 121-123)
- Final `finishedAt - startedAt` duration for done/error (lines 137-142)
- `"—"` for done/error with missing timestamps (lines 126, 138-140)

Tests confirm: backlog/actionable/blocked return "—" (lines 58-71), done returns final duration (line 88-93), error returns final duration (lines 95-100), and missing timestamps return "—" (lines 102-127).

### 5. The change remains dashboard-only and does not alter detail-view timing behavior
**PASS** — `useDurationTick` is defined and used exclusively in `DashboardView.tsx`. A codebase-wide search for `useDurationTick` and `setInterval.*1.000` confirmed no references outside of DashboardView.tsx. The detail view is unaffected.

## Test Results

| Test Suite | Tests | Pass | Fail |
|---|---|---|---|
| duration.test.ts | 22 | 22 | 0 |
| beadsAdapterTiming.test.ts | 8 | 8 | 0 |
| dashboard.test.ts | 12 | 12 | 0 |

All 42 tests pass.

## Key Implementation Files

- `apps/ralphe/src/tui/DashboardView.tsx` — Core implementation: `useDurationTick`, `hasActiveTimedTask`, `computeDuration`, `formatDuration`
- `apps/ralphe/src/beadsAdapter.ts` — `normalizeRalpheMeta` for timing metadata parsing, `WatchTask` type with `startedAt`/`finishedAt`
- `apps/ralphe/tests/duration.test.ts` — 22 tests covering formatting, computation, and tick activation
- `apps/ralphe/tests/beadsAdapterTiming.test.ts` — 8 tests covering metadata parsing
- `apps/ralphe/tests/dashboard.test.ts` — 12 tests covering partitioning and formatting
