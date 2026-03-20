# Verification Report: Preserve error label on mark-ready and prioritize ready in mapStatus

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Verification

### 1. markTaskReady preserves the error label — PASS
**File:** `src/beads.ts` lines 208-222

`markTaskReady` iterates over `currentLabels` and removes each label **except** `"error"`. The error label is explicitly preserved via the `if (label !== "error")` guard. Then it adds the `"ready"` label.

### 2. mapStatus returns queued for open + error + ready — PASS
**File:** `src/beadsAdapter.ts` lines 205-210

The `ready` label check (line 208) comes **before** the `error` label check (line 210). A task with both `["ready", "error"]` labels and status `"open"` returns `"queued"`.

**Test:** `"error + ready label on open task with no deps → queued (ready overrides error for retry)"` (beadsAdapter.test.ts line 464)

### 3. mapStatus still returns error for open + error (no ready) — PASS
**File:** `src/beadsAdapter.ts` line 210

When a task has only `["error"]` label and no `"ready"` label, it falls through the ready check and hits the error check, returning `"error"`.

**Test:** `"open + error label without ready → error"` (beadsAdapter.test.ts line 301)

### 4. queryQueued picks up error + ready tasks — PASS
`queryQueued` filters tasks by `status === "queued"`. Since `mapStatus` now maps `error + ready` to `"queued"`, these tasks are included.

**Test:** `"error issues with ready label are included as queued (retry)"` (beadsAdapter.test.ts line 692)

### 5. Error label is cleared on successful task completion — PASS
**File:** `src/beads.ts` lines 155-162

`closeTaskSuccess` calls `removeLabel(id, "error")` before closing the task.

**Test:** `"successfully completed retry task (closed, error cleared) derives to done"` (beadsAdapter.test.ts line 628)

### 6. Re-failed task has ready removed and error kept — PASS
**File:** `src/beads.ts` lines 230-244

`markTaskExhaustedFailure` removes the `"ready"` label and adds/keeps the `"error"` label.

**Test:** `"re-failed task (ready removed, error kept) derives to error"` (beadsAdapter.test.ts line 619)

## Test Results

- `bun test tests/beadsAdapter.test.ts` — **63 pass, 0 fail**
- `bun test tests/beads.test.ts` — **4 pass, 0 fail**

## Conclusion

All 6 acceptance criteria are correctly implemented and verified by passing tests.
