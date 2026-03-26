# Verification: Update write-a-prd for approved epic-creation flow

**Date:** 2026-03-26
**Status:** ✅ PASS

## Summary

The global `write-a-prd` skill at `~/.agents/skills/write-a-prd/SKILL.md` has been updated to support the approved epic-creation flow as specified in the parent PRD (`apps/ralphe/docs/prd-global-skills-epic-prd-flow.md`). All five acceptance criteria are satisfied.

## What was verified

### File location
- **Path:** `/Users/terencek/.agents/skills/write-a-prd/SKILL.md`
- **Symlinked into Claude skills:** `~/.claude/skills/write-a-prd -> /Users/terencek/.agents/skills/write-a-prd`
- **Last modified:** 2026-03-26 09:15:39

### Acceptance Criteria

#### ✅ 1. write-a-prd still drafts PRD text before mutating system state
The skill defines a clear **Phase 1: Draft the PRD** with six steps (gather problem, explore repo, pressure-test, sketch modules, confirm testing, draft PRD). No system-of-record mutation happens during this phase.

#### ✅ 2. Approval remains required before the skill creates or updates the system-of-record object
**Phase 2: Approval (required boundary)** explicitly presents the draft to the user and iterates until explicit approval. The skill includes a bold callout: *"Do not create, update, or write to any system-of-record object until the user has approved the draft. This review boundary is required, not optional."*

#### ✅ 3. After approval, the default action is to create a new epic
**Phase 3, step 9** states: *"Default action: create a new epic."* It specifies using `bd create` with `--type epic` and the approved PRD body as the description. The guidance section reinforces: *"Always default to creating a new epic. Do not improvise alternate post-approval flows."*

#### ✅ 4. If an epic is already explicitly in context, the skill may update that epic instead
**Phase 3, step 10** covers the exception: *"If an epic is already explicitly in context (e.g., the user provided an epic ID or the conversation is scoped to an existing epic), you may update that epic with the approved PRD body instead of creating a new one."* It also guards against loose inference: *"Do not infer an epic from loose context; it must be explicitly present."*

#### ✅ 5. The resulting epic is treated as the PRD container in the global planning workflow
**Phase 3, step 11** explicitly states: *"The resulting epic (created or updated) is the PRD container in the global planning workflow. Downstream skills like prd-to-issues will operate on this epic."* The guidance section reinforces: *"The epic is the PRD container. It is not a tracking ticket or a task; it is the source of truth for the PRD content."*

### Scope compliance
- The skill description in the frontmatter correctly summarizes the new behavior.
- The skill remains scoped to global skill behavior—no repo-local ralphe execution logic is embedded.
- The PRD template is preserved for the drafting phase.
- Command examples use `bd create` and `bd update` (tool-agnostic at the global skill level).

## What could not be verified

- **Runtime execution:** The write-a-prd skill is an agent instruction document (SKILL.md), not executable code. Its behavior is enacted by an AI agent interpreting the instructions. There is no automated test suite or CLI command that can simulate skill execution. Verification is limited to inspecting the skill content against the acceptance criteria.
- **Integration with prd-to-issues:** The downstream integration (prd-to-issues operating on the created epic) was not tested as it is outside the scope of this task.

## Conclusion

The `write-a-prd` SKILL.md correctly implements all five acceptance criteria. The three-phase workflow (draft → approve → create/update epic) is clearly documented with explicit defaults, guard rails against improvisation, and proper scoping to global skill behavior.
