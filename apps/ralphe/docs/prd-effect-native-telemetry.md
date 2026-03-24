## Problem Statement

Ralphe’s telemetry and remote logging now work, but the infrastructure around them is only partially aligned with the rest of the Effect-based codebase. The orchestration layer uses Effect well, but telemetry startup, shutdown, buffering, flushing, timers, and failure reporting are still managed with module-global mutable state, `setInterval`, `process.on("exit")`, `fetch`, and `console.error`. That creates weaker lifecycle guarantees than the rest of the app and makes it harder to reason about resource ownership, cleanup, and delivery behavior for short-lived runs.

From a developer perspective, the current stack works more like imperative Node/Bun infrastructure attached to an Effect program than like a first-class Effect subsystem. This makes the code less composable, less testable in a principled way, and more likely to lose logs or traces during shutdown.

## Solution

Refactor ralphe telemetry and remote log shipping into scoped, Layer-provided Effect services. Replace global mutable singleton state with Effect-managed resources, queues, refs, schedules, and cleanup. Keep the existing user-facing telemetry behavior, Axiom integration, span names, and remote log policy, but make the lifecycle Effect-native: startup happens through Layers, flushing happens through supervised fibers or scoped resources, and shutdown is tied to Effect scope instead of `process.on("exit")`.

The goal is not to change what telemetry ralphe emits. The goal is to make the telemetry subsystem behave like the rest of the app.

## User Stories

1. As a maintainer of ralphe, I want telemetry and remote logging to be represented as Effect services so their lifecycle is explicit, composable, and testable.
2. As a developer running short-lived `ralphe run` commands, I want trace and log flushing to be tied to Effect scope so telemetry is less likely to be lost at process exit.
3. As a developer extending ralphe, I want telemetry plumbing to use the same Effect patterns as the rest of the codebase so I can reason about it without dropping into ad hoc global state and manual timers.

## Implementation Decisions

### Refactor target

This is an architectural refactor of the telemetry subsystem, not a new product feature. The existing trace export destination, span set, remote log level policy, env-based configuration, and Axiom integration remain intact unless a change is required to support the Effect-native lifecycle cleanly.

### Service boundaries

Split telemetry concerns into explicit Effect-managed services:

- a trace service responsible for tracer initialization, span helper access, and scoped shutdown
- a remote log shipping service responsible for buffering, batching, and flush lifecycle
- a logger composition layer that consumes those services and produces the active Effect logger configuration for CLI and TUI modes

The call-site API should stay simple for the rest of the app. Existing orchestration code should continue to ask for a span wrapper or log through Effect without learning about transport internals.

### Configuration handling

Move env-driven config loading for telemetry into an explicit configuration boundary rather than ad hoc module reads from `process.env`. The implementation may still source values from the same environment variables, but it should do so through an Effect-friendly config path so missing configuration becomes a normal service-mode decision instead of hidden module state.

### Scoped lifecycle

Telemetry initialization and cleanup should become scoped resources. The runtime should acquire them at program startup and release them when the Effect program ends. This removes the need to rely on `process.on("exit")` for async flushes.

Direct CLI runs, headless watch mode, and TUI mode should all use the same scoped lifecycle approach. TUI mode may still swap logger presentation behavior, but it should not fork the ownership model for telemetry resources.

### Remote log buffering model

Replace the current manual buffer and `setInterval` timer with an Effect-native batching model. Suitable primitives include a queue plus a background flushing fiber, a schedule-driven drain loop, and refs for small in-memory state where needed.

The batching model should preserve the current remote log policy:

- ship `info`, `warn`, and `error`
- keep `debug` local-only
- keep local logging intact
- remain fail-open

The refactor should improve delivery guarantees without turning telemetry into a blocking dependency of task execution.

### Failure handling

Telemetry and remote log shipping remain best-effort. Service initialization failures, flush failures, or Axiom outages must not break task execution. The difference is that failure handling should be expressed through Effect control flow and supervised fibers rather than isolated `console.error` branches scattered through imperative code.

### Span context propagation

The existing Effect-oriented span-context work should be preserved. The refactor should keep the current trace hierarchy behavior and avoid regressing nested span propagation while the ownership model moves into services and Layers.

### Logger composition

The current composed logger setup should be recast as a Layer-driven composition of sinks rather than a set of module-level helper constructors. CLI mode should still combine stderr, local file logging, and remote shipping. TUI mode should still suppress stderr while keeping file and remote sinks. The user-visible behavior remains the same; the difference is that logger construction should depend on scoped services instead of globals.

### Testing philosophy

Tests should validate both behavior and lifecycle:

- services initialize and release cleanly
- background flush fibers are supervised and shut down correctly
- remote shipping remains fail-open
- short-lived programs can flush more reliably than before
- existing tracing and remote log semantics are preserved

Prefer deterministic local fakes, in-memory exporters, Effect test seams, and scope-driven assertions over tests that depend on real timers or process-exit hooks.

## Testing Decisions

- Add service-level tests for scoped acquisition and release of telemetry resources.
- Add batching and flush tests for the remote log service using deterministic test doubles rather than real time and real network access where possible.
- Verify that CLI and TUI logger composition still produce the same effective sink behavior after the refactor.
- Verify that short-lived run paths no longer depend on `process.on("exit")` to flush telemetry.
- Preserve the existing span hierarchy and remote log policy tests so the refactor does not regress user-visible telemetry behavior.

## Out of Scope

- New span names, new datasets, or broader telemetry scope.
- Changing the remote log level policy from `info`/`warn`/`error`.
- Cross-process propagation into subprocesses or external agent runtimes.
- Dashboard, alerting, or retention work in Axiom.
- Reworking ralphe’s task orchestration, retry semantics, or watch workflow beyond the telemetry lifecycle boundary.

## Further Notes

- The desired end state is not “telemetry implemented with more Effect syntax.” It is “telemetry behaves like a proper Effect subsystem with scoped ownership and supervised background work.”
- This refactor should make the codebase more consistent and reduce the class of bugs where telemetry silently drops data because cleanup lives outside the Effect runtime.
- If a pragmatic bridge is needed during migration, prefer wrapping the old behavior behind a service boundary first and then replacing internals, rather than rewriting every caller at once.
