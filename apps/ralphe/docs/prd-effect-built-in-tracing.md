## Problem Statement

`ralphe` currently implements tracing through a custom telemetry helper that manually starts OpenTelemetry spans, carries parent context through a `FiberRef`, and manages tracer bootstrap and shutdown outside the Effect tracing model. The current code works, but it duplicates behavior that Effect now supports natively through its own tracing API.

From a maintainer’s perspective, the current approach makes tracing harder to reason about than it needs to be. Instead of using the standard Effect tracing abstraction, `ralphe` maintains a hand-rolled bridge between Effect code and OpenTelemetry context propagation. That increases custom surface area, keeps tracing semantics slightly off the mainline Effect path, and makes the codebase harder to align with official Effect tracing guidance.

The goal is to move `ralphe` tracing onto Effect’s built-in span model while preserving the existing observable tracing behavior that matters to developers investigating runs.

## Solution

Replace `ralphe`’s custom span wrapper with Effect’s built-in tracing API and wire OpenTelemetry export through the official Effect integration path. The migration should keep `ralphe`’s tracing behavior best-effort and fail-open, preserve the current span hierarchy intent, and avoid expanding scope into a full rewrite of remote logging or unrelated telemetry behavior.

This is a tracing migration, not a user-facing feature change. Developers should continue to see useful traces for `ralphe` runs, but the implementation should become more Effect-native and require less custom OpenTelemetry plumbing.

## User Stories

1. As a maintainer of `ralphe`, I want tracing to use Effect’s built-in span abstraction, so the code follows the framework’s intended tracing model instead of custom glue.
2. As a developer investigating a `ralphe` run, I want span nesting and trace export to remain coherent, so traces are still useful after the migration.
3. As a maintainer evolving telemetry later, I want tracing to sit on official Effect integration points, so future observability work composes with less bespoke infrastructure.

## Implementation Decisions

- The scope of this change is tracing only.
- The existing custom span helper should be removed as the primary tracing abstraction.
- `ralphe` should use Effect’s built-in span API at call sites instead of a repo-local span wrapper.
- OpenTelemetry export should be wired through the official Effect integration path rather than through manual span creation and manual parent-context propagation.
- The migration should preserve the current trace hierarchy intent:
  - top-level task run span
  - attempt-level spans
  - step-level spans for agent, checks, report, and git operations where those spans still exist today
- The migration should preserve the fail-open tracing contract. Missing configuration, exporter issues, or tracing initialization problems must not break task execution.
- The migration should not require callers to learn low-level tracer plumbing. Tracing use at orchestration call sites should stay simple and explicit.
- Manual `FiberRef`-based parent span propagation should be removed if the official Effect tracing path now owns that concern.
- Startup and shutdown should be reviewed in light of the new tracing integration so `ralphe` does not keep redundant or conflicting manual tracer lifecycle code after the migration.
- Existing span names and their role in developer workflows should be preserved unless the migration requires a deliberate documented change.
- This slice should not silently expand into a full rewrite of remote logging, logger composition, or non-tracing telemetry behavior.
- The migration should be written so it composes cleanly with future broader telemetry refactors, including the existing effect-native telemetry direction already documented elsewhere in the repo.

## Testing Decisions

- Strong regression coverage should stay focused on tracing behavior that developers actually rely on:
  - nested span hierarchy
  - success and failure behavior under tracing
  - no-op / fail-open behavior when tracing is unconfigured or broken
  - preservation of intended task/attempt/step span structure
- Existing telemetry and hierarchy tests should be rewritten or re-anchored around the new tracing boundary rather than around the custom span helper internals.
- Tests should verify that the migration removes the need for custom parent-context plumbing without regressing nesting behavior.
- Tests should continue to prove that tracing does not alter success or failure outcomes of the wrapped Effects.
- If the official Effect tracing integration changes startup or shutdown behavior, add focused tests around those lifecycle expectations rather than assuming parity.

## Out of Scope

- Rewriting remote log shipping.
- Replacing the file logger or changing logger presentation behavior.
- Changing `ralphe` task orchestration, retry semantics, or workflow ownership.
- Introducing new span names, new telemetry destinations, or broader observability product changes.
- A generalized observability rewrite beyond what is necessary to move tracing onto Effect’s built-in span model.

## Further Notes

- The main question this PRD answers is not “should `ralphe` keep tracing?” It is “should tracing continue to be implemented through custom span plumbing when Effect already has a first-class tracing model?” The answer is no.
- This change should reduce custom code and make the tracing layer look more like ordinary Effect code.
- If a pragmatic bridge is needed during migration, prefer a short-lived compatibility layer at the boundary rather than preserving the current custom helper as a permanent abstraction.
