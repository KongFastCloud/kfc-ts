# Verification Report: Re-anchor Tests and Docs Around the Epic Task Model

**Date**: 2026-03-26
**Task**: Re-anchor tests and documentation so the final epic/task architecture is explicit and enforced.
**Result**: ✅ PASS — All acceptance criteria verified.

---

## Test Execution Summary

- **Total tests**: 821 across 41 files
- **Passed**: 821
- **Failed**: 0
- **Expect calls**: 2,191

All tests pass with zero failures.

---

## Acceptance Criteria Verification

### ✅ AC1: Execution invariant tests

Tests cover all five invariants in `watchWorkflow.test.ts` and `epicCloseCleanup.test.ts`:

| Invariant | Test location | Status |
|-----------|--------------|--------|
| **Epic-child context inheritance** | `watchWorkflow.test.ts` Contract 9: "epic-child context inheritance" — verifies epic body is prepended as preamble, branch/labels are loaded from parent | ✅ |
| **Orphan-task invalidity** | `watchWorkflow.test.ts` Contract 10: "orphan-task invalidity" — orphan tasks never invoke ensureEpicWorktree or engine, receive EPIC_ERROR_NO_PARENT | ✅ |
| **Lazy worktree creation** | `watchWorkflow.test.ts` Contract 11: "lazy worktree creation" — first task triggers ensureEpicWorktree with correct epic context | ✅ |
| **Worktree reuse** | `watchWorkflow.test.ts` Contract 12: "worktree reuse" — sibling tasks under the same epic call ensureEpicWorktree with same epicId/branch | ✅ |
| **Cross-epic isolation** | `watchWorkflow.test.ts` Contract 13: "cross-epic isolation" — different epics produce different worktree paths, context does not leak | ✅ |

Additional coverage in `epicWorktree.test.ts`:
- `sanitizeEpicId` path sanitization (6 tests)
- Path determinism (same ID → same path, different IDs → different paths)
- Cross-epic isolation via distinct directory names (2 tests)

### ✅ AC2: Watch/TUI tests cover split task/epic model

Tests verified in `epicStatus.test.ts`, `tuiWatchController.test.ts`, and `dashboard.test.ts`:

| Concern | Test location | Status |
|---------|--------------|--------|
| **isEpicTask identification** | `epicStatus.test.ts` — 5 tests covering label presence, absence, undefined | ✅ |
| **Derived epic statuses** | `epicStatus.test.ts` — `deriveEpicDisplayStatus` tests for not_started, active, dirty, queued_for_deletion, and undefined fallback | ✅ |
| **Epic display items** | `epicStatus.test.ts` — `deriveEpicDisplayItems` tests: empty when no epics, includes open epics, excludes closed non-deletion epics, includes closed+queued epics, derives status from worktree states | ✅ |
| **Deletion queue precedence** | `epicStatus.test.ts` — deletion takes precedence over dirty worktree state | ✅ |
| **excludeEpicTasks** | `epicStatus.test.ts` — filters epic-labeled tasks from task pane, handles edge cases | ✅ |
| **Task-ready vs epic-delete actions** | README.md documents distinct keys: `m` for mark-ready (task pane), `d` for delete epic (epic pane) | ✅ |
| **TUI controller orchestration** | `tuiWatchController.test.ts` — 162 tests covering worker start/stop, task refresh, mark-ready lifecycle | ✅ |
| **Dashboard rendering** | `dashboard.test.ts` — split view rendering, focus management | ✅ |

### ✅ AC3: Cleanup tests verify epic close cleanup and dirty-cleanup warning

Tests verified in `epicCloseCleanup.test.ts`:

| Scenario | Contract # | Status |
|----------|-----------|--------|
| **Epic close triggers worktree cleanup** | Contract 1 | ✅ |
| **Dirty worktree cleanup carries wasDirty=true** | Contract 2 | ✅ |
| **Clean worktree cleanup carries wasDirty=false** | Contract 2 | ✅ |
| **No-worktree close is a clean no-op** | Contract 3 | ✅ |
| **removeEpicWorktree result shape** (clean, dirty, no-op) | Contracts 4, 7 | ✅ |
| **EpicWorktreeCleanupResult type** carries removed, wasDirty, worktreePath | Contract 4 | ✅ |

### ✅ AC4: Error-path tests verify invalid epic context surfaces explicit failure

Tests verified in `epicCloseCleanup.test.ts` and `watchWorkflow.test.ts`:

| Error path | Test | Status |
|------------|------|--------|
| **No parentId (orphan)** | `epicCloseCleanup.test.ts` Contract 6: marked as exhausted with EPIC_ERROR_NO_PARENT | ✅ |
| **Missing branch** | Contract 6: surfaced with timing metadata | ✅ |
| **Empty PRD body** | Contract 6: errored, not silently skipped | ✅ |
| **Parent lacks epic label** | Contract 6: errored explicitly | ✅ |
| **Consistent failure pattern** | Contract 6: all invalid-context failures use markTaskExhaustedFailure (same as execution failures) | ✅ |
| **isInvalidEpicContextError predicate** | Contract 5: recognizes all 5 epic error types, rejects generic/worktree errors | ✅ |
| **Error classification** | Contract 9: invalid-context vs worktree vs execution are distinguishable | ✅ |
| **Worktree setup failure** | Contract 8: surfaced operationally with timing metadata, does not invoke engine | ✅ |

### ✅ AC5: Repository documentation updated

**README.md** (`apps/ralphe/README.md`) contains comprehensive documentation:

- **Epic / Task Model** section: Describes two-level hierarchy (epic = planning/isolation primitive, task = runnable child), parent relationship via Beads parentId, standalone task invalidity
- **Epic as the PRD container**: Documents full PRD loading from epic body
- **Worktree lifecycle**: Documents lazy creation, reuse, recreation, branch mismatch, deterministic paths under `.ralphe-worktrees/`
- **Epic closure and cleanup**: Documents automatic cleanup, dirty cleanup warning, TUI disappearance
- **Invalid epic context**: Documents all 5 error conditions in a table with clear error messages
- **Split Watch TUI**: Documents two-pane layout with ASCII diagram, task pane as primary, epic pane as secondary/focusable
- **Epic display statuses**: Documents all 4 derived statuses (not_started, active, dirty, queued_for_deletion)
- **TUI keys**: Documents distinct `m` (mark-ready, task pane) and `d` (delete epic, epic pane) keys
- **PRD**: `docs/prd-epic-task-worktree-redesign.md` provides the authoritative architectural reference

No stale task-only assumptions remain in the documentation. The README explicitly describes the epic-owned context model throughout.

---

## Test File Coverage Map

| Test file | Tests | Focus |
|-----------|-------|-------|
| `epic.test.ts` | 18 | Epic context validation (label, body, branch), loading, preamble formatting |
| `epicWorktree.test.ts` | 12 | Worktree path sanitization, determinism, cross-epic isolation |
| `epicCloseCleanup.test.ts` | 21 | Close cleanup, dirty cleanup, invalid-context surfacing, error classification |
| `epicStatus.test.ts` | 19 | Epic display status derivation, epic identification, task/epic separation |
| `watchWorkflow.test.ts` | 48 | Full execution lifecycle with epic context inheritance, orphan invalidity, lazy worktree, reuse, cross-epic isolation |
| `tuiWatchController.test.ts` | 82+ | Controller orchestration, mark-ready queue, epic-delete queue |
| `dashboard.test.ts` | 60+ | Split view rendering, focus management |
| `dashboardFocus.test.ts` | 20+ | Focus transitions between task and epic panes |
