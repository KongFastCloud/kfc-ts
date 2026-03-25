## Problem Statement

The global planning skills currently assume a PRD-first workflow that is separate from the execution object model. `$write-a-prd` is oriented around drafting a PRD as a document, and `$prd-to-issues` is oriented around taking a PRD document and creating runnable issues from it. That no longer matches the desired planning flow for `ralphe`, where the epic itself is the PRD container and child tasks are the runnable decomposition under that epic.

Because these skills are global and shared across agent environments rather than being local repo modules, they should not be treated as implicit implementation details of the `ralphe` repo. They need their own explicit design contract so agents do not mix repo-local execution behavior with global planning-skill behavior.

## Solution

Update the global `$write-a-prd` and `$prd-to-issues` skills so they support an epic-centered PRD workflow:

- `$write-a-prd` drafts PRD text first, then after approval defaults to creating a new epic that stores the PRD body
- `$prd-to-issues` operates on an existing epic and creates child tasks under it

The skills should remain tool-agnostic in the sense that they are global skills, but they should gain explicit behavior for the epic-as-PRD flow used by `ralphe` and later by similar systems. The key is to make their defaults and completion criteria explicit enough that agents do not invent incompatible intermediate workflows.

## User Stories

1. As an operator using the global planning skills, I want `$write-a-prd` to draft first and only create/update an epic after approval, so there is a clear review boundary before system state changes.
2. As an operator using `$prd-to-issues`, I want decomposition to happen from an existing epic rather than a separate PRD file, so planning and execution share the same source of truth.
3. As a maintainer of the global skills, I want the epic-centered behavior to be explicit and unambiguous, so agents using different clients or symlinked skill directories behave consistently.

## Implementation Decisions

- These changes belong to the global skills, not the `ralphe` repo-local execution logic.
- `$write-a-prd` should continue to draft PRD text first.
- The user must approve the PRD before the skill writes it into the system of record.
- Default post-approval behavior should be to create a new epic.
- If an epic is already explicitly in context, the agent may update it instead.
- The default case remains new-epic creation because that is the normal operator flow.
- The epic created or updated through this flow should be treated as the PRD container.
- `$prd-to-issues` should operate on an existing epic, not on a separate PRD file path in the new epic-centered flow.
- It should prefer current epic context when available.
- If no epic is already in context, it should require an explicit epic identifier.
- `$prd-to-issues` may create child tasks and then attach parent/dependency structure in follow-up steps once IDs exist.
- The workflow is only complete when every created runnable task has been attached to the epic parent and any approved dependencies have been applied.
- The skill should not leave created runnable tasks parentless at the end of execution.
- The skill changes should be written in a way that is tool-agnostic at the global skill level while still being explicit about the epic-centered planning workflow.

## Testing Decisions

- Validate the default skill behavior through focused examples and acceptance criteria rather than repo-local runtime tests.
- Confirm `$write-a-prd` preserves the review boundary:
  - draft first
  - approval required
  - create new epic by default after approval
- Confirm `$prd-to-issues` preserves the epic-centered decomposition contract:
  - operates from an existing epic
  - prefers current epic context
  - requires explicit epic ID when no context exists
  - finishes with all created tasks attached to the epic parent
- The global skill documentation/examples should be updated so agents do not fall back to the old PRD-file assumptions.

## Out of Scope

- Repo-local `ralphe` execution behavior.
- TUI redesign.
- Worktree lifecycle and branch ownership logic.
- A full `ralphly` implementation.
- Client-specific behavior tied to one editor or one skill directory layout.

## Further Notes

- The main reason to separate this PRD is to keep the boundary clear: the skills are global planning tools, while `ralphe` is a repo-local execution system.
- This separation should reduce confusion for future workers by making it obvious which behavior belongs to the repo and which behavior belongs to the shared skill layer.
