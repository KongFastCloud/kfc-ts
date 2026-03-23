## Problem Statement

Ralphe can already log what happened during a task run, but it does not publish a trace of where time was spent across the loop lifecycle. When a ralphe loop feels slow, there is no centralized per-step view showing how long each attempt spent in agent execution, verification checks, report generation, git operations, or CI waiting. That makes it harder to identify which parts of the loop are worth optimizing and whether slowness is local to ralphe or caused by an external dependency.

## Solution

Instrument ralphe loop execution with OpenTelemetry spans and export them to Axiom. Replace the current Effect-based span timing approach with OpenTelemetry as the single tracing system for performance analysis. Capture parent and child spans across the full orchestration path so each run can be broken down by attempt and major step. Keep the attribute set intentionally small, measure external work from the outside rather than propagating trace context into child processes, and make tracing fail open so telemetry problems never block ralphe execution.

## User Stories

1. As a developer investigating a slow ralphe run, I want to see a span breakdown for each loop attempt so I can tell whether time is going to the agent, checks, reporting, git steps, or CI.
2. As a developer comparing loop behavior across tasks, I want traces in Axiom so I can identify recurring bottlenecks instead of relying on one local terminal session.
3. As a ralphe user, I want tracing to stay out of the way so that missing credentials, exporter failures, or Axiom outages do not break `ralphe run` or `ralphe watch`.

## Implementation Decisions

### Trace model

Use a parent/child span tree for a full ralphe task execution:

- `task.run`
- `loop.attempt`
- `agent.execute`
- `check.run`
- `report.verify`
- `git.commit`
- `git.push`
- `git.wait_ci`

`task.run` represents the full wall-clock duration of one ralphe task execution. `loop.attempt` represents a single retry attempt inside that task. Child spans represent the major orchestration steps inside each attempt or post-attempt flow.

### Attribute discipline

Keep span attributes minimal in v1:

- `issue.id` when running against a Beads task
- `engine`
- `loop.attempt`
- `loop.max_attempts`
- `check.name`

Do not attach task text, prompts, issue titles, resume tokens, full shell commands, stdout, stderr, branch names, or git mode to spans.

### Tracing ownership

OpenTelemetry becomes the only tracing system for this feature. Existing Effect log-span timing should be removed rather than maintained in parallel. Ralphe may continue to use Effect logging for regular log messages, but per-step timing should come from OpenTelemetry traces in Axiom only.

### Measurement boundary

Measure external work from the outside:

- Wrap agent execution as a single `agent.execute` span.
- Wrap each configured verification command as its own `check.run` span.
- Wrap report generation as `report.verify`.
- Wrap commit, push, and CI wait operations individually.

Do not attempt cross-process trace propagation into shell commands, Codex, Claude internals, GitHub CLI, or any subprocesses in v1. The goal is orchestration-level attribution, not end-to-end distributed tracing.

### Export behavior

Initialize OpenTelemetry once at program startup and export to Axiom using an OpenTelemetry-compatible trace exporter configuration. Tracing must be best-effort only:

- If tracing is not configured, ralphe runs normally without exporting traces.
- If exporter initialization fails, ralphe runs normally and logs the problem.
- If export or flush fails, ralphe still completes normally and logs the problem.

Tracing must not change task success or failure outcomes.

### Runtime integration

Tracing should be wired into all ralphe entrypoints that execute loop work, including direct CLI runs and watch-mode task execution. TUI mode and headless mode should share the same tracing initialization path so behavior stays consistent across execution modes.

### Module changes

The implementation should introduce a dedicated telemetry module responsible for tracer startup, exporter configuration, and shutdown handling. The orchestration modules should be updated to create spans around the existing lifecycle boundaries without changing core control flow. Existing task, loop, command, report, engine, and git workflows should remain structurally the same; the change is to wrap those workflows with spans, not redesign them.

### Shutdown semantics

Add a single shutdown path for telemetry flushing at process exit where practical, but keep it non-blocking from the user’s perspective. If flush cannot complete within a reasonable time, ralphe should still exit. Watch mode should not attempt to flush after every poll cycle; it should use the long-lived tracer provider for the life of the process.

## Testing Decisions

- Extend existing orchestration-focused tests rather than introducing broad integration-only coverage.
- Verify that span creation happens at the intended lifecycle boundaries for task, attempt, checks, reporting, and git operations.
- Verify that retries produce separate `loop.attempt` spans with the correct attempt metadata.
- Verify that each configured check creates its own `check.run` span with only the allowed attributes.
- Verify that tracing failures are fail-open and do not convert successful runs into failed runs.
- Verify that unconfigured tracing behaves as a no-op and preserves existing CLI and watcher behavior.
- Prefer dependency seams and in-memory telemetry fakes over global mocks so tests remain deterministic.

## Out of Scope

- Cross-process trace propagation into spawned commands or external agent runtimes.
- Capturing prompt contents, command outputs, or other high-cardinality payloads in span attributes.
- Metrics, logs export, or dashboard design beyond the trace data needed for Axiom.
- Alerting, sampling policy tuning, or retention strategy beyond a basic working export path.
- Changes to ralphe task semantics, retry logic, or git workflow behavior.

## Further Notes

- CI wait time is intentionally included. It is part of the end-to-end ralphe loop experience even though the work happens in an external system.
- The trace tree should answer “where did this run spend time?” not “which subsystem is at fault?” Those are related but different questions.
- If future work needs finer attribution inside a single step, it can add child spans under the existing names rather than renaming the top-level contract.
