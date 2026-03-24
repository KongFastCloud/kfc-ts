## Problem Statement

`ralphe` and `blueprints` currently blur ownership of execution behavior. `ralphe` still owns a full agent runner with retry, checks, reporting, git flow, and tracker-side effects, while `blueprints` also exposes a central runner that tries to own the same orchestration. This creates duplicated orchestration logic, mixed config models, and an unclear boundary between app policy and shared execution primitives.

The current design also makes workflow changes harder than they should be. Ordering decisions such as `check -> report` versus `report -> check` are effectively baked into a shared runner instead of being assembled explicitly by the app that needs them. At the same time, `ralphe` stores and passes around a mixed config shape that combines engine choice, execution semantics, and persistence concerns into one object.

`ralphly` already consumes the shared `blueprints.run()` contract, so any cleanup in `blueprints` will ripple into `ralphly`. If the shared runner is removed or demoted without a migration plan, `ralphly` will break at both the API and test-contract level.

## Solution

Refactor `blueprints` into a primitives-first execution toolkit rather than a canonical runner. Shared ownership should stop at reusable execution steps and low-level combinators. App-level orchestration should move into the callers.

`ralphe` should become a thin app that assembles a workflow explicitly from `blueprints` primitives. It should build a pure-data per-run request, resolve collaborators through Effect services, and use a `RunObserver` abstraction for lifecycle side effects such as Beads comments. This makes workflow order explicit in code and lets app concerns stay app-owned.

`ralphly` should be migrated in the same refactor window so it no longer depends on `blueprints.run()`. It should preserve its current session-write contract and backlog semantics, but rebuild its issue execution path using the same shared primitives model rather than a shared orchestrator.

## User Stories

1. As a maintainer of `ralphe`, I want workflow assembly to live in one explicit app-level builder so I can change execution order or add steps without fighting a shared runner.
2. As a maintainer of `blueprints`, I want the package to own only reusable execution primitives so its API boundary stays small, honest, and composable.
3. As a maintainer of `ralphly`, I want to preserve Linear session lifecycle behavior while migrating off the shared runner so issue processing stays correct during the refactor.
4. As a developer experimenting with execution policy, I want options to live next to the step that consumes them so configuration does not turn into a global bag of mixed concerns.

## Implementation Decisions

- `blueprints` will be treated as a primitives package. Its long-term owned surface should be:
  - `Engine` interface and agent result types
  - retry loop primitive and loop event types
  - command execution step
  - verification report step
  - git primitives and git-specific result/error types
  - shared tagged error types
- The shared top-level runner should be removed as the center of gravity. No new work should depend on a canonical `run()` pipeline in `blueprints`.
- `ralphe` should introduce a pure-data `RunRequest` model representing one invocation. It should contain execution inputs only, not resolved collaborators or service instances.
- `ralphe` should stop centering its design around a persisted mixed config model. Request assembly should happen programmatically at the entrypoint from CLI input, task input, watch context, and code defaults.
- `ralphe` should introduce an app-level workflow builder, such as `buildRunWorkflow(request)`, as the single place where orchestration lives.
- The app-level workflow builder should compose `blueprints` primitives explicitly:
  - agent execution
  - retry loop
  - check execution
  - report execution
  - git execution
  - final result shaping
- Workflow order should be an explicit app decision in the builder, not hidden inside a shared config contract.
- `ralphe` should resolve collaborators through Effect services rather than embedding them into request values. At minimum:
  - engine resolution should be a service
  - observer behavior should be a service
- `RunObserver` should be a full-lifecycle app abstraction. It should own run-related side effects such as start, loop-event, agent-result, and completion reactions.
- `RunObserver` should be composable so `ralphe` can combine Beads behavior with other observers later without forcing that concern into `blueprints`.
- `ralphe` should keep tracing as an app concern. Losing existing inner span parity is acceptable for this refactor. `blueprints` should remain unaware of tracing and telemetry shape.
- CLI run mode and watch mode should share the same workflow builder. They may have different request factories and observer implementations, but should not silently fork execution semantics unless there is a deliberate future reason to do so.
- `ralphly` should be refactored to own its issue-level workflow assembly rather than calling the removed shared runner.
- `ralphly` should preserve its current durable session-write contract:
  - start is written on entry
  - retry-related intermediate events remain observable
  - success and terminal failure remain explicit terminal writes
- `ralphly` should either adopt its own observer-backed workflow builder or an equivalent local composition model that uses `blueprints` primitives directly. It should not regain a hidden private runner that recreates the same ownership problem under another name.
- The refactor should align workspace handling across both apps. Workspace should remain an explicit execution input passed to the primitives that require it.
- Package and app docs should be updated to reflect the new ownership model:
  - `blueprints` documents primitives and composition patterns
  - `ralphe` documents request assembly and workflow ownership
  - `ralphly` documents its local issue-processing assembly and any remaining config needed for Linear integration

## Testing Decisions

- Strong tests should move toward the actual ownership boundaries after the refactor.
- `blueprints` tests should focus on primitive contracts only:
  - retry semantics for the loop
  - feedback propagation
  - workspace propagation into command, report, and git steps
  - tagged error behavior
  - engine interface behavior
- Shared-runner tests in `blueprints` should be deleted or rewritten once the runner is removed.
- `ralphe` should gain builder-level orchestration tests that verify:
  - intended step order
  - retry behavior around the chosen pipeline
  - git behavior for each mode
  - resume token shaping
  - observer lifecycle behavior
- `ralphe` comment-format and watch-mode regression tests should remain strong, but should be re-anchored around the new observer and workflow builder seams rather than the old mixed config/run-task module.
- `ralphly` tests should preserve the behaviors that matter today:
  - task-input construction
  - durable session activity contract
  - retry feedback propagation
  - same-session retry behavior
  - backlog draining and readiness behavior
- `ralphly` acceptance tests that currently describe the `blueprints.run()` contract should be rewritten to target `ralphly`'s local workflow assembly instead of the deleted shared runner.
- A successful refactor should leave both apps with orchestration tests at the app boundary and primitives tests at the package boundary, with no important behavior owned only by documentation.

## Out of Scope

- Preserving backward compatibility for the current `ralphe` config schema or CLI config flow.
- Preserving the existing detailed telemetry span tree.
- Introducing a new universal observer abstraction for every possible multi-agent workflow.
- Reworking `ralphly` backlog semantics, Linear readiness rules, or durable hold rules beyond what is required to migrate off the shared runner.
- Designing a new generalized workflow DSL for `blueprints`.

## Further Notes

- The main architectural goal is not just to delete a runner. It is to move ownership to the right layer:
  - shared package owns reusable Effect primitives
  - app owns orchestration, observers, and product-specific policy
- If a future app needs a different execution order or additional steps, that should be expressed by assembling a different workflow in the app, not by expanding a shared runner config surface.
- This refactor should prefer explicit assembly over convenience wrappers whenever a wrapper would hide workflow policy.
