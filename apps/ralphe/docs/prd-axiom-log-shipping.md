## Problem Statement

Ralphe already emits useful structured operational logs locally, but those logs only exist in the terminal session and the local `.ralphe/logs/` files. That makes it hard to monitor whether ralphe is behaving correctly across runs, especially when the question is not just "where did time go?" but "did the loop progress through the expected lifecycle, and what exactly failed when it did not?" Traces help with timing and failure location, but they are not the best tool for operational log search, ongoing health monitoring, or reading the specific sequence of major milestones across many runs.

## Solution

Ship ralphe operational logs to Axiom in addition to local logging. Keep traces and logs as separate signals with separate datasets. Send `info`, `warn`, and `error` log events to Axiom so developers can confirm that ralphe is progressing normally and can investigate failures across runs, while keeping `debug` logs local-only to avoid noisy and expensive remote ingestion. Preserve the current local logging behavior, but add a remote Axiom log sink that is fail-open and intentionally constrained to structured milestone events rather than raw high-volume output.

## User Stories

1. As a developer watching ralphe in production-like usage, I want to see remote `info` logs so I can tell that tasks are being claimed, attempts are running, checks are passing, and workflows are completing normally.
2. As a developer investigating failures, I want `warn` and `error` logs in Axiom so I can search recurring failures across many runs without needing access to the original terminal session.
3. As a ralphe user, I want log shipping failures to stay out of the execution path so Axiom outages or misconfiguration do not break `ralphe run` or `ralphe watch`.

## Implementation Decisions

### Signal separation

Keep logs and traces as separate Axiom signals and separate datasets. Trace export and log export solve different problems and should not share one dataset. Log shipping should target a dedicated Axiom logs dataset configured via environment variables, alongside the existing Axiom trace configuration.

### Remote log level policy

Send only `info`, `warn`, and `error` logs to Axiom in v1. Keep `debug` local-only.

This policy is specifically intended to preserve the signal developers need for operational visibility while avoiding the churn of highly repetitive polling logs, retry heartbeat logs, and other low-level debugging noise. Existing `debug` logs should continue to appear in local logging where helpful.

### Remote log selection

The goal is not "ship everything that currently logs." Evaluate log sites and ensure the remote stream contains milestone events and meaningful state transitions, such as:

- watcher start and stop
- task discovery and claim
- attempt start
- agent start and completion
- check pass and check failure
- verification start, pass, and failure
- commit, push, and CI lifecycle milestones
- task completion and exhausted retries

Avoid remote shipping of noisy polling and heartbeat-style logs that are useful locally but low-value remotely, especially repeated "checking again" or "retrying soon" messages.

### Structured fields

Remote log payloads should remain structured and low-risk. Include only the fields needed to correlate logs with runs and spans:

- timestamp
- log level
- message
- `issue.id` when present
- `engine`
- `loop.attempt`
- `loop.max_attempts`
- `check.name` when relevant
- `trace_id`
- `span_id`

Avoid sending task text, prompts, issue titles, resume tokens, full shell commands, full stdout, and full stderr. If failure context needs to be retained, prefer concise structured fields such as error type, short error message, exit code, or a short preview rather than unbounded payloads.

### Logger architecture

Preserve the current local logger behavior and add a remote Axiom sink as an additional destination for approved events. The logger stack should support:

- stderr output for live terminal visibility where appropriate
- local JSON log files for on-machine debugging
- Axiom remote shipping for operational visibility

TUI mode should keep its existing behavior of suppressing stderr noise while still allowing local file logging and remote Axiom shipping.

### Configuration

Assume Axiom credentials are provided through environment variables loaded from the repository root `.env.local`. Log shipping should use its own dataset setting rather than reusing the traces dataset. The implementation should tolerate missing log-shipping configuration and degrade to local-only logging with no task failure.

### Fail-open behavior

Remote log shipping must be best-effort only:

- missing configuration disables remote log shipping without failing ralphe
- Axiom initialization failures disable remote shipping without failing ralphe
- network or export failures do not change task success or failure outcomes

When possible, shipping failures should be surfaced through local logging without causing recursive logging loops or flooding the local logger with repeated exporter errors.

### Runtime integration

Log shipping should be initialized once per process and shared across direct CLI runs, headless watch mode, and TUI watch mode. It should not require callers to thread logging handles through unrelated business logic. Existing Effect logging call sites should continue to express intent through log levels, while the logger implementation decides which events stay local and which are also shipped remotely.

### Relationship to tracing

This work complements the tracing PRD rather than replacing it. Traces remain the tool for duration and step hierarchy. Remote logs provide the searchable milestone and failure narrative around those traces. Correlation between the two should be preserved through trace and span identifiers on log events when available.

## Testing Decisions

- Extend logger-focused and orchestration-focused tests to verify that `info`, `warn`, and `error` events are eligible for remote shipping while `debug` remains local-only.
- Verify that milestone logs expected for normal task execution appear in the remote-eligible stream.
- Verify that noisy polling-style debug logs do not get shipped remotely.
- Verify that TUI mode preserves its stderr suppression while still allowing remote shipping.
- Verify that missing env configuration or Axiom failures do not cause `ralphe run` or `ralphe watch` to fail.
- Use deterministic local fakes for the remote sink rather than live Axiom access.

## Out of Scope

- Shipping `debug` logs remotely in v1.
- Sending prompts, task text, resume tokens, full command output, or other high-cardinality raw payloads.
- Replacing local file logs with Axiom-only logging.
- Metrics export, alert definitions, dashboards, or retention tuning beyond the needs of basic log shipping.
- Changing ralphe workflow semantics, retry behavior, or task state transitions.

## Further Notes

- The remote logs stream should answer "is ralphe progressing normally?" and "what milestone or failure happened?" while traces answer "where did the time go?"
- If future investigation needs richer debugging context, it is better to add a narrowly scoped structured field than to start shipping raw unbounded output by default.
- The boundary between local-only debug logs and remotely shipped milestone logs should be deliberate and documented so future log additions do not accidentally increase remote noise.
