# Verification: Remove Shared Runner and Re-anchor Tests to New Ownership Model

**Date:** 2026-03-24
**Status:** PASS

## Summary

The shared blueprints runner has been successfully removed and all tests and documentation have been re-anchored to the new ownership model. All acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. blueprints.run() and shared runner surface removed ✅

- `packages/blueprints/src/runner.ts` — **deleted** (confirmed via git diff and filesystem check)
- `packages/blueprints/src/index.ts` — no `run` export; public API surface covers only primitives (Engine, loop, agent, cmd, report, git primitives, git composition helpers, error types)
- Grep for `blueprints.run(` across all `.ts` files — **zero matches**
- Grep for `import.*runner.*from.*blueprints` — **zero matches**

### 2. Runner-centric blueprints tests removed; remaining tests cover only primitive contracts ✅

- `packages/blueprints/tests/runner.test.ts` — **deleted**
- Remaining 7 test files cover primitives only:
  - `cmd.test.ts` — command execution primitive
  - `engine.test.ts` — Engine interface contract
  - `errors.test.ts` — CheckFailure and FatalError types
  - `git.test.ts` — git primitives (commit, push, CI wait, dirty check)
  - `loop.test.ts` — retry loop primitive
  - `report.test.ts` — verification report step
  - `workspace-cwd.test.ts` — workspace threading contract (explicitly notes "Workflow-level workspace propagation is tested in the consuming apps")
- **34 tests pass, 0 failures**

### 3. ralphe orchestration tests target workflow builder and observer seams ✅

- Tests reference `buildRunWorkflow`, `RunObserver`, `watchWorkflow`, `BeadsRunObserver` — all app-owned orchestration seams
- 8 test files directly test ralphe workflow/observer boundaries
- **690 tests pass, 0 failures**

### 4. ralphly orchestration tests target local issue-processing assembly ✅

- `apps/ralphly/src/runner.ts` is ralphly's **own** issue runner, explicitly documented: "This composition is local and explicit — there is no shared runner abstraction mediating between ralphly and the primitives."
- `apps/ralphly/tests/runner.test.ts` tests ralphly's local workflow assembly
- No imports from blueprints runner; ralphly imports only primitives (loop, agent, cmd, report, buildCiGitStep, etc.)
- **255 tests pass, 0 failures**

### 5. Documentation consistently describes final ownership model ✅

- **`packages/blueprints/README.md`**: "Primitives-first execution toolkit... Apps (ralphe, ralphly) compose their own workflows from these building blocks. Blueprints does not own orchestration policy, step ordering, or lifecycle side effects."
- **`packages/blueprints/src/index.ts`**: Header comment clearly states ownership boundary — primitives vs. app concerns
- **`apps/ralphly/README.md`**: "ralphly owns its own workflow assembly — orchestration, session lifecycle, and side effects are app concerns, not delegated to a shared runner."
- **`apps/ralphe/docs/prd-ralphe-blueprints-primitives.md`**: Marked as complete — "The shared runner (`blueprints.run()`) has been removed."
- No stale references to blueprints as canonical orchestrator in source or documentation files (remaining mentions in PRD are historical context describing the problem being solved)

## Test Results

| Package | Tests | Pass | Fail |
|---------|-------|------|------|
| packages/blueprints | 34 | 34 | 0 |
| apps/ralphe | 690 | 690 | 0 |
| apps/ralphly | 255 | 255 | 0 |
| **Total** | **979** | **979** | **0** |

## Changed Files (git diff)

| Status | File |
|--------|------|
| Modified | `apps/ralphe/docs/prd-ralphe-blueprints-primitives.md` |
| Modified | `apps/ralphly/README.md` |
| Modified | `packages/blueprints/README.md` |
| Modified | `packages/blueprints/src/index.ts` |
| Deleted | `packages/blueprints/src/runner.ts` |
| Deleted | `packages/blueprints/tests/runner.test.ts` |
| Modified | `packages/blueprints/tests/workspace-cwd.test.ts` |
