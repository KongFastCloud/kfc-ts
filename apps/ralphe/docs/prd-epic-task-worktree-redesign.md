## Problem Statement

`ralphe` currently treats an individual task as the top-level planning and execution unit. That works for simple queueing, but it is the wrong primitive for multi-stream implementation work. A single task does not provide an isolated long-lived workspace boundary, does not naturally hold the full PRD context, and does not give the operator a clean way to work across multiple independent implementation streams without state bleeding between them.

The missing concept is an epic-level isolation boundary. The operator wants to work on multiple PRD-sized efforts concurrently, with each effort owning its own branch and worktree so partial changes, errors, and workspace state do not leak across efforts. Tasks should remain the runnable units, but they should execute inside an epic-owned context instead of acting as the top-level unit themselves.

The current watch TUI is also shaped around the old model. It is task-centric without a first-class epic operational view, so it does not surface the new isolation boundary cleanly.

## Solution

Redesign `ralphe` around a strict two-level model:

- epic = the planning, isolation, and workspace primitive
- task = the runnable child unit under one epic

Each epic should be represented as a Beads issue labeled `epic`. The epic issue body should contain the full PRD text. Every runnable task must be a child issue of exactly one epic, and the parent relationship should be the source of truth for execution context inheritance.

Each epic should own exactly one canonical branch and exactly one canonical worktree. The worktree should be created lazily when the first child task runs, then reused by later tasks under that epic. Tasks should not create their own branches or worktrees. The scheduler should continue to select tasks globally, but each task should execute inside its parent epic’s isolated context.

The watch TUI should move to a split model:

- task pane remains the main operational surface
- epic pane becomes a secondary but focusable operational view for epic state

## User Stories

1. As an operator using `ralphe`, I want each PRD-sized effort to own an isolated branch and worktree, so work from one epic does not leak into another.
2. As an operator, I want tasks to remain the runnable units, so the queueing and dependency model stays familiar even though execution context now comes from the parent epic.
3. As an operator, I want the watch TUI to show both global tasks and epic-level workspace state at the same time, so I can act on tasks while still understanding the isolation boundary they belong to.
4. As a future maintainer of `ralphly`, I want this model to map cleanly to later GitLab/Linear epic-plus-child-task concepts, so Beads is not redesigned in a way that must be conceptually undone later.

## Implementation Decisions

### Core domain model

- The redesign uses a strict two-level hierarchy only:
  - epic
  - task
- Deeper execution hierarchy should not be introduced in this slice.
- An epic is a Beads issue labeled `epic`.
- Epic issues are non-runnable.
- Runnable work remains task-shaped.
- Every runnable task must belong to exactly one epic.
- Parent-child structure is the source of truth for epic membership.
- Standalone tasks are ignored by the executor as valid work sources.

### Epic as the PRD container

- The epic issue body should hold the full PRD text.
- PRDs are no longer treated as file-backed source documents for the main `ralphe` flow.
- Epic and PRD are one-to-one in this model.
- The executor should load:
  - child task content
  - full parent epic body
  - required epic metadata
- This full parent body load is intentional and should not be optimized away in this slice.

### Epic execution context

- Each epic owns exactly one canonical branch.
- The branch name is derived by the agent when the epic is created and stored as canonical epic metadata.
- Each epic owns exactly one canonical worktree.
- Tasks do not create their own branches.
- Tasks execute directly in the epic-owned branch/worktree.
- Worktrees should all live under one fixed global `ralphe` worktree root.
- That worktree root should not be configurable in this slice.
- Worktree paths should be derived from epic identity under that global root rather than stored as required epic metadata.

### Worktree lifecycle

- Epic worktrees are created lazily when the first child task is actually executed.
- Epic creation itself does not require immediate worktree creation.
- Once created, later tasks under the same epic reuse the same worktree.
- If the executor needs the worktree and it does not exist, it should recreate it from the epic’s canonical branch and derived path.

### Scheduling and dependencies

- The scheduler continues to select from ready tasks globally.
- The execution primitive remains the task, not the epic.
- Only one task runs at a time globally.
- Epic isolation is about persistent workspace state, not parallel execution.
- Dependencies for runnable tasks are only allowed within the same epic.
- Cross-epic task dependencies are not part of this model.
- Task failure should only block work according to dependency structure, not freeze the whole epic by default.

### Invalid epic context

- If a task’s parent epic is missing required runtime context, the executor should not guess or fall back to repo-default behavior.
- The task should be marked errored similarly to the current exhausted/error handling model, with a clear reason indicating invalid epic context.
- Minimum epic runtime requirements should be explicit:
  - `epic` label
  - epic body containing PRD content
  - canonical branch metadata

### Epic closure and cleanup

- Closing an epic should trigger worktree cleanup.
- Cleanup should proceed automatically without TUI confirmation.
- If the epic worktree is dirty, cleanup should still proceed, but the system should emit or record a warning.
- Once cleanup is complete, the epic should disappear from the watch TUI.
- Cleanup semantics in this slice should stay simple and operator-fast rather than introducing a second cleanup lifecycle state machine.

### Watch TUI redesign

- The TUI should move to a split view.
- Task pane remains the primary operational pane.
- Task pane shows all tasks globally.
- Epic pane is secondary but focusable and navigable on its own.
- Epic pane should show operational epic information, not attempt to be a full PRD reader by default.
- Minimum epic pane display should include:
  - epic ID
  - epic title
  - one derived epic status

### Epic status in the TUI

- Epic status should be one derived display status, not a collection of independent badges.
- Required statuses in this slice:
  - `not_started` when no epic worktree exists yet
  - `dirty` when the epic worktree exists and is dirty
  - `queued_for_deletion` when the operator marks the epic for deletion/cleanup
- Epic status is derived from a combination of Beads issue state and workspace/runtime state.
- The TUI should show:
  - all open epics
  - closed epics that are queued for deletion
- Epics should disappear from the TUI after cleanup completes.

### TUI actions and key behavior

- Task-ready and epic-delete operations should use different keys.
- The TUI should not overload one key across both operations.
- The current task-ready behavior should remain task-focused.
- Epic deletion queueing should be immediate and should not require interactive confirmation.
- If the selected task has no parent epic, it may still appear in the task list. If selected for execution, it should fail due to invalid epic context.
- The epic pane should be able to show that no valid parent epic exists for the selected task.

### Migration assumptions

- No outstanding legacy standalone-task migration path is required in this slice.
- The redesign can assume there will not be remaining outstanding tasks that need compatibility handling.
- No compatibility mode is required for orphan-task execution.

### Future alignment with `ralphly`

- This design should remain conceptually portable to future `ralphly` work.
- The Beads epic/task model should be shaped so it can later map cleanly onto GitLab/Linear parent-child concepts rather than forcing a later conceptual rewrite.

## Testing Decisions

- Strong tests should be added around the new execution invariants:
  - standalone tasks are ignored or error as invalid execution inputs
  - child tasks inherit context from the parent epic
  - first task lazily creates the epic worktree
  - later tasks reuse the same epic worktree and branch
  - cross-epic execution does not leak workspace state
- Watch-mode tests should be expanded to cover the new split epic/task model and epic-derived status behavior.
- TUI behavior tests should cover:
  - global task list remains primary
  - epic pane displays derived statuses correctly
  - epic pane can receive focus and be navigated
  - task-ready and epic-delete actions are distinct
- Cleanup tests should verify that epic close triggers worktree removal and dirty cleanup emits or records a warning.
- Error-path tests should verify that tasks with missing or invalid epic context surface the expected error handling rather than falling back silently.

## Out of Scope

- Parallel task execution across epics.
- Deeper-than-two-level execution hierarchies.
- Cross-epic task dependencies.
- A full PRD file system alongside epic-owned PRD content.
- A configuration surface for choosing the global worktree root.
- A sophisticated cleanup confirmation or blocked-cleanup workflow.
- Automatic cleanup of child tasks when an epic is deleted.
- A full `ralphly` implementation in this slice.

## Further Notes

- The key architectural distinction is:
  - epic is the isolation and planning primitive
  - task is still the runnable unit
- This redesign should not accidentally regress into “task-only with extra labels.” The parent epic must actually own branch/worktree context and PRD identity.
- The TUI should reflect the same truth: tasks stay operationally primary, but epics become first-class contextual state rather than invisible metadata.
