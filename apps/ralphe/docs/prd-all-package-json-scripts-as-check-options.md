## Problem Statement

`ralphe config` currently discovers check commands from the root `package.json`, but it only considers a hardcoded subset of script names. That makes the config flow too opinionated for repositories that rely on differently named verification scripts or custom repo-wide workflows. A maintainer can only choose from the specific script names that `ralphe` already knows about, even when the correct verification command already exists in the root package scripts.

This creates unnecessary friction in monorepos and custom setups. The config wizard should help the maintainer select the right repo-level verification commands, not force the repo to conform to a short built-in list.

## Solution

Change `ralphe config` so it exposes all root `package.json` scripts as selectable check options instead of filtering to a fixed subset. The wizard should still operate only on the root package scripts for the current working directory, but it should no longer hide scripts simply because their names are not `typecheck`, `lint`, `test`, or `build`.

To keep the experience safe and predictable, the wizard should preserve a default-selection policy rather than auto-enabling everything. Common verification scripts should remain enabled by default, while all other scripts should be visible but opt-in.

## User Stories

1. As a maintainer configuring `ralphe`, I want to choose from all root package scripts, so I can use my repo’s real verification commands without renaming them to fit `ralphe`.
2. As a maintainer of a monorepo, I want `ralphe` to keep using root-level scripts only, so verification stays aligned with repo-wide health rather than drifting into nested package behavior.
3. As a maintainer of `ralphe`, I want the auto-discovery rules to stay predictable and testable, so expanding the script list does not create hidden defaults or surprising execution behavior.

## Implementation Decisions

- The scope of this change is limited to script discovery and config-wizard selection behavior.
- `ralphe` should continue to discover scripts only from the root `package.json` for the current working directory.
- Nested workspace or package-level scripts should remain out of scope for auto-discovery in this slice.
- All script entries under the root `package.json` should be presented as selectable check options in the config wizard.
- The wizard should continue to store the selected commands as explicit shell commands in `.ralphe/config.json`.
- Runtime execution should remain unchanged: `ralphe run` and watch-mode request assembly should continue to execute whatever commands are already present in the stored `checks` array.
- Default selection should remain intentional rather than broad:
  - common verification-style scripts should remain enabled by default
  - other scripts should be shown but disabled by default
- The default-enabled set should be explicit and documented. At minimum, the current verification-oriented defaults should remain the baseline.
- Command generation should continue to respect the detected package manager when translating script names into runnable commands.
- The change should not silently alter the root-only detection boundary or the current package-manager detection behavior.
- Documentation should be updated to describe the new behavior precisely:
  - the wizard shows all root scripts
  - root-only discovery still applies
  - selected scripts are persisted and later executed as configured checks

## Testing Decisions

- The strongest unit coverage should live with project/script detection because that is the owned contract changing in this slice.
- Detection tests should be expanded to prove that:
  - all root scripts are surfaced as selectable options
  - the root-only boundary remains intact when nested package scripts also exist
  - package-manager-specific command rendering still works
  - default-enabled behavior is correct for the intended verification scripts and false for non-default scripts
- Existing config load/save tests should remain valid because the persisted `checks` shape is not changing.
- If there is no current direct test around config-wizard choice preparation, this slice should add enough coverage to lock down the mapping from package scripts to selectable check options.
- README examples and wording should be kept consistent with the final behavior so a maintainer can predict what `ralphe config` will show before running it.

## Out of Scope

- Changing how `ralphe run` executes configured checks.
- Discovering scripts from nested packages or workspaces.
- Automatically selecting every discovered script by default.
- Inferring whether arbitrary custom scripts are “safe” or “good” verification commands beyond the explicit default-selection policy.
- Changing the workflow builder, `RunRequest`, or observer architecture.

## Further Notes

- This is a usability and repo-fit improvement, not a workflow-architecture change.
- The most important guardrail is visibility without surprise: maintainers should be able to select any root script, but `ralphe` should not suddenly start running additional commands by default.
- If the repo later wants richer script classification, that should be treated as a separate design decision rather than folded silently into this slice.
