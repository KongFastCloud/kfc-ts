## Problem Statement

Ralphe is successfully exporting OpenTelemetry spans to Axiom, but the exported spans are not appearing as a coherent trace tree. Instead of a single `task.run` trace containing nested `loop.attempt`, `agent.execute`, `check.run`, `report.verify`, and git spans, the data shows multiple spans with different trace IDs. That breaks the main value of the tracing work: developers can see that steps happened, but they cannot inspect one end-to-end run as a single hierarchy.

The current instrumentation proves export works, but not trace structure. Without proper parent-child propagation, the Axiom view is fragmented and much less useful for understanding a ralphe loop.

## Solution

Fix the telemetry integration so spans created by `withSpan()` become the active context for nested work. Ensure child spans inherit the trace context of their parent and export as one trace tree per task run. Keep the existing span names and attribute discipline, but make the hierarchy real. Add regression tests that assert parent-child relationships and shared trace IDs, not just span presence.

## User Stories

1. As a developer inspecting a ralphe run in Axiom, I want `task.run` to contain all child work in one trace so I can understand the full lifecycle of a task from one view.
2. As a developer debugging retries, I want each `loop.attempt` span to appear under the correct task trace so I can compare attempts within the same run.
3. As a maintainer of ralphe telemetry, I want tests to verify trace relationships, not only span names, so the hierarchy cannot silently regress while spans continue to export.

## Implementation Decisions

### Root cause

The telemetry helper currently starts spans but does not make the created span active while running the wrapped Effect. That means nested `withSpan()` calls create new root spans instead of child spans. The fix should be applied at the telemetry abstraction layer rather than patching each individual call site.

### Ownership of the fix

Keep `withSpan()` as the single orchestration-facing tracing helper and make it responsible for:

- creating the span
- activating its context for the wrapped work
- recording errors and status
- ending the span exactly once

Call sites should continue to express span boundaries through `withSpan()` and should not need to manually manage OpenTelemetry contexts.

### Trace hierarchy contract

The intended hierarchy remains:

- `task.run`
- `loop.attempt`
- `agent.execute`
- `check.run`
- `report.verify`
- `git.commit`
- `git.push`
- `git.wait_ci`

The fix is not a renaming exercise. The names and attribute contract stay the same; the change is that nested spans must share a trace ID and correct parent-child relationships.

### Context propagation model

Use OpenTelemetry’s context APIs to run the wrapped Effect within the span’s active context. The parent span should remain active throughout the wrapped Effect so any nested `withSpan()` invocation automatically becomes a child. This should work for direct CLI runs, watcher-driven runs, and any nested orchestration paths already using `withSpan()`.

### Error handling

Preserve the existing fail-open behavior of telemetry:

- if span creation fails, the underlying Effect still runs
- if status or end operations fail, the underlying Effect result is preserved
- telemetry must never change task success or failure behavior

The fix should improve hierarchy without making tracing brittle.

### Export behavior

This PRD does not change the export destination, span set, or attribute allowlist. Axiom remains the trace destination and the existing env-based telemetry configuration stays in place. The focus is trace structure, not exporter replacement or dataset reconfiguration.

### Test strategy shift

The current tests primarily verify that span names are emitted. That is not sufficient. Add tests that assert:

- child spans share the same trace ID as their enclosing `task.run`
- child spans have the correct parent span IDs
- retries produce multiple `loop.attempt` spans under one task trace
- orchestration spans such as `agent.execute`, `check.run`, and git spans appear beneath the expected parent attempt or task span

Where helpful, update existing span tests rather than creating an entirely parallel test suite.

## Testing Decisions

- Extend telemetry and span hierarchy tests to assert trace ID continuity and parent span relationships.
- Verify that a full task pipeline exports one trace tree rather than disconnected root spans.
- Verify that retry flows create multiple sibling `loop.attempt` spans under the same `task.run`.
- Verify that error cases still produce the expected hierarchy for spans that were entered before failure.
- Keep tests local and deterministic using in-memory exporters rather than live Axiom access.

## Out of Scope

- Changing span names, adding new spans, or expanding the attribute schema.
- Switching trace exporters, changing Axiom datasets, or altering env configuration semantics.
- Cross-process propagation into shell commands, Claude internals, Codex internals, or GitHub CLI.
- Remote log shipping or any logging changes.
- Reworking retry, git, or watcher behavior beyond what is required for correct span hierarchy.

## Further Notes

- The evidence for this PRD is direct Axiom output showing expected span names with different trace IDs instead of one nested trace.
- This is a correctness issue in the tracing layer, not a product-scope expansion.
- Once hierarchy is fixed, Axiom becomes much more useful immediately without needing additional span types.
