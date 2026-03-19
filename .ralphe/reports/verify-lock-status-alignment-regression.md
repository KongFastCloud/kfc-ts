# Verification Report: Lock Status Alignment With Regression Coverage

**Date:** 2026-03-19
**Result:** PASS

## Summary

All 73 tests across 2 test files pass, covering the full status alignment model defined in `prd/ralphe-status-alignment.md`. The tests are integrated into the existing `beadsAdapter.test.ts` and `watchLifecycle.test.ts` suites, as required by the design.

## Test Execution

```
bun test v1.3.9
 73 pass
 0 fail
 143 expect() calls
Ran 73 tests across 2 files. [1389.00ms]
```

## Acceptance Criteria Verification

### ✅ Tests cover derivation of backlog, actionable, blocked, active, done, and error

**beadsAdapter.test.ts** contains explicit tests for each derived status:
- `open + no ready + no error + no blockers → backlog` (line 230)
- `open + ready + no error + no blockers → actionable` (line 237)
- `open + unresolved blocking deps → blocked` (line 251)
- `open + error label → error` (line 266)
- `in_progress → active` (line 288)
- `closed → done` (line 295)
- `cancelled → error` (line 432)

Additional label precedence tests verify error overrides ready (line 444) and error overrides blockers (line 452).

### ✅ Tests prove only actionable issues are claimed by the executor

**beadsAdapter.test.ts** — "actionable filtering" suite (line 528):
- Mixed list filtering shows only `ready-1` survives (line 532)
- Backlog, blocked, error, active, done are all excluded
- Error issues with ready label still excluded (line 578)

**watchLifecycle.test.ts** — "only actionable issues are picked up" suite (line 588):
- Empty ready queue → no claims (line 594)
- Executor does not independently query for non-actionable work (line 612)
- Worker only processes what `queryActionable()` returns

### ✅ Tests prove exhausted failures remain open and are not automatically returned to ready

**watchLifecycle.test.ts** — "exhausted failures remain open" suite (line 432):
- Failed task calls `markTaskExhaustedFailure`, NOT `closeTaskSuccess`/`closeTaskFailure` (line 433)
- No close calls produced after failure (line 695)
- Failure reason preserved in metadata (line 464)

**Source verification** (`beads.ts` line 195): `markTaskExhaustedFailure()` keeps task open, removes `ready` label, adds `error` label.

### ✅ Tests prove open errored dependencies keep dependents blocked while closed-success dependencies unblock them

**beadsAdapter.test.ts** — Dependency blocking regression suite (line 349):
- Open errored dependency keeps dependent blocked (line 302)
- Mixed deps: one closed + one open → still blocked (line 353)
- Closed dependency unblocks regardless of labels (line 384)
- All deps closed → actionable when ready label present (line 401)
- Cancelled deps resolve (line 319)
- In-progress deps block (line 334)
- Parent-child dependencies do not cause blocking (line 369)

**beadsAdapter.test.ts** — Actionable filtering suite:
- Open errored dependency keeps dependent out of actionable set (line 587)
- Only genuinely resolved (closed) deps unblock into actionable (line 600)

## Implementation Correctness

The `mapStatus()` function (beadsAdapter.ts:143) implements the PRD priority order:
1. `in_progress` → `active`
2. `closed` → `done`
3. `cancelled` → `error`
4. `open` + error label → `error` (highest open-task priority)
5. `open` + unresolved blocking deps → `blocked`
6. `open` + ready label → `actionable`
7. Default → `backlog`

The `markTaskExhaustedFailure()` function (beads.ts:195) correctly:
- Keeps the task open (no close call)
- Removes `ready` label
- Adds `error` label
- Persists failure reason

The executor (`tuiWorker.ts`) uses `queryActionable()` as its sole source of work, which filters to `status === "actionable"` only.

## Conclusion

All four acceptance criteria are fully covered with regression tests integrated into existing suites. The implementation correctly aligns with the PRD.
