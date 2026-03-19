# Verification Report: Restrict Automatic Pickup To Actionable Issues

**Date:** 2026-03-19
**Status:** PASS

## Summary

All acceptance criteria are met. The implementation correctly restricts automatic pickup to only actionable issues (open, ready, not errored, not blocked) through a well-structured status derivation and filtering pipeline.

## Acceptance Criteria Verification

### 1. Automatic pickup only considers issues that are open, ready, not errored, and not blocked — PASS

**Implementation:** `queryActionable()` in `beadsAdapter.ts` (lines 271-287) fetches all tasks, derives status via `mapStatus()`, and filters to only `status === "actionable"`. The `mapStatus()` function (lines 143-171) derives "actionable" only when:
- Beads status is `"open"`
- Labels include `"ready"`
- Labels do NOT include `"error"`
- No unresolved blocking dependencies (deps with `dependency_type === "blocks"` and status not `"closed"` or `"cancelled"`)

**Watcher:** `watcher.ts` (line 71) calls `queryActionable()` as the sole source of tasks. The TUI worker (`tuiWorker.ts`) uses the same `queryActionable()` function.

**Tests verified:**
- `beadsAdapter.test.ts`: "only actionable tasks survive filtering from a mixed list" — mixed list of backlog, ready, blocked, error, active, done tasks; only the ready one passes
- `watchLifecycle.test.ts`: "empty ready queue means no claims are made" — confirms executor respects empty actionable results

### 2. Backlog, blocked, and error issues are never claimed automatically — PASS

**Implementation:**
- Backlog: `open + no ready + no error + no blockers → backlog` (excluded from actionable filter)
- Blocked: `open + unresolved blocking deps → blocked` (excluded from actionable filter)
- Error: `open + error label → error` (excluded from actionable filter, error takes priority over blocked/ready)

**Tests verified:**
- "backlog issues are excluded from automatic pickup"
- "blocked issues are excluded from automatic pickup even with ready label"
- "error issues are excluded from automatic pickup"
- "error issues with ready label are still excluded"
- "executor does not independently query for non-actionable work" — confirms no fallback queries

### 3. Open errored dependencies continue to keep dependents blocked — PASS

**Implementation:** In `mapStatus()`, dependency blocking check (lines 155-162) considers any dependency with `status !== "closed" && status !== "cancelled"` as unresolved. An errored dependency has Beads status `"open"` (not closed), so it remains an unresolved blocker.

**Tests verified:**
- "open errored dependency keeps dependent blocked" — dep with open status blocks the dependent
- "open errored dependency keeps dependent out of actionable set" — dep-1 is open+error, t-1 depends on it and is excluded from actionable
- "in_progress deps still block" — confirms non-closed statuses block

### 4. Only genuinely resolved dependencies unblock downstream issues — PASS

**Implementation:** Only `closed` and `cancelled` dependency statuses are treated as resolved (lines 159-160). All other statuses (open, in_progress, etc.) keep the dependency unresolved and the dependent blocked.

**Tests verified:**
- "only genuinely resolved (closed) dependencies unblock into actionable"
- "maps open with resolved blocking deps and ready label to actionable"
- "cancelled deps do not block" — cancelled is treated as resolved

## Additional Verification

### Exhausted Failure Semantics — PASS
- `markTaskExhaustedFailure()` in `beads.ts` (lines 195-211): removes `"ready"` label, adds `"error"` label, keeps task open
- Watcher calls this on failure (watcher.ts lines 118-124), does NOT call `closeTaskSuccess` or `closeTaskFailure`
- watchLifecycle test: "failed task is marked as error and remains open" confirms no close calls after failure

### Test Results
- **130 tests pass across 15 files**, 0 failures
- Key test files:
  - `beadsAdapter.test.ts`: 35 tests covering status derivation and actionable filtering
  - `watchLifecycle.test.ts`: Integration tests for poll→claim→execute→close lifecycle

## Architecture Notes

- `queryActionable()` is the **authoritative gate** for automatic pickup (as specified in the design)
- Status derivation priority: error > blocked > actionable > backlog
- The watcher and TUI worker both use `queryActionable()` — no alternate code paths
- Worker logic is deterministic and backend-focused (no UI-side filtering)
